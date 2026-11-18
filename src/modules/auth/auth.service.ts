import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "../../config";
import { AppError } from "../../errors/AppError";
import type { Role } from "../../generated/prisma/client";
import { exchangeGoogleCode, type GoogleProfile, verifyGoogleIdToken } from "../../lib/google";
import { prisma } from "../../lib/prisma";
import { AuditAction, logAudit } from "../../utils/audit";
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyOAuthState,
  verifyRefreshToken,
} from "../../utils/jwt";
import { notify } from "../../utils/notify";
import { safeUserSelect } from "../user/user.constant";
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterDriverInput,
  RegisterInput,
} from "./auth.validation";

type ClientMeta = { ip?: string; userAgent?: string };
type TokenUser = { id: string; email: string; role: Role };

/** Issues an access token + a rotating refresh token (stored hashed in DB). */
const issueTokens = async (user: TokenUser, meta: ClientMeta) => {
  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id, jti: crypto.randomUUID() });
  const { exp } = verifyRefreshToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: new Date((exp ?? 0) * 1000),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 255),
    },
  });

  return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: config.jwt.accessExpiresIn };
};

const assertEmailAvailable = async (email: string) => {
  const existing = await prisma.user.findUnique({ where: { email }, select: { deletedAt: true } });
  if (existing?.deletedAt) {
    throw new AppError(409, "This account was deleted. Please contact support to restore it.");
  }
  if (existing) {
    throw new AppError(409, "An account with this email already exists", [
      { path: "email", message: "Email already registered" },
    ]);
  }
};

const register = async (input: RegisterInput, meta: ClientMeta) => {
  await assertEmailAvailable(input.email);
  const password = await bcrypt.hash(input.password, config.bcryptSaltRounds);

  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, phone: input.phone, password, role: "PATIENT" },
    select: safeUserSelect,
  });

  await logAudit({
    actorId: user.id,
    actorRole: user.role,
    action: AuditAction.USER_REGISTERED,
    entity: "User",
    entityId: user.id,
    ip: meta.ip,
  });

  return { user, ...(await issueTokens(user, meta)) };
};

/**
 * Drivers self-register, but cannot receive dispatches until an admin verifies
 * their license (DriverProfile.isVerified) and assigns them an ambulance.
 */
const registerDriver = async (input: RegisterDriverInput, meta: ClientMeta) => {
  await assertEmailAvailable(input.email);
  const password = await bcrypt.hash(input.password, config.bcryptSaltRounds);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        password,
        role: "DRIVER",
        driverProfile: {
          create: {
            licenseNumber: input.licenseNumber,
            licenseExpiry: input.licenseExpiry,
            experienceYears: input.experienceYears,
          },
        },
      },
      select: { ...safeUserSelect, driverProfile: true },
    });

    await logAudit(
      {
        actorId: created.id,
        actorRole: "DRIVER",
        action: AuditAction.USER_REGISTERED,
        entity: "User",
        entityId: created.id,
        metadata: { licenseNumber: input.licenseNumber },
        ip: meta.ip,
      },
      tx,
    );

    const admins = await tx.user.findMany({
      where: { role: "ADMIN", deletedAt: null, status: "ACTIVE" },
      select: { id: true },
    });
    await notify(
      {
        userIds: admins.map((a) => a.id),
        type: "SYSTEM",
        title: "New driver awaiting verification",
        message: `${created.name} (${input.licenseNumber}) registered as a driver.`,
        metadata: { driverUserId: created.id },
      },
      tx,
    );
    return created;
  });

  return { user, ...(await issueTokens(user, meta)) };
};

const login = async (input: LoginInput, meta: ClientMeta) => {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Same message for "no user" and "wrong password" to prevent account enumeration.
  const invalid = new AppError(401, "Invalid email or password");
  if (!user || user.deletedAt) throw invalid;
  if (!user.password) {
    throw new AppError(400, "This account uses Google sign-in. Please log in with Google.");
  }
  const ok = await bcrypt.compare(input.password, user.password);
  if (!ok) throw invalid;
  if (user.status === "BLOCKED") throw new AppError(403, "Your account has been blocked");

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
    select: safeUserSelect,
  });

  await logAudit({
    actorId: user.id,
    actorRole: user.role,
    action: AuditAction.USER_LOGIN,
    entity: "User",
    entityId: user.id,
    metadata: { provider: "CREDENTIALS" },
    ip: meta.ip,
  });

  return { user: updated, ...(await issueTokens(updated, meta)) };
};

/** Finds or creates the user for a verified Google profile, linking existing email accounts. */
const loginWithGoogleProfile = async (profile: GoogleProfile, meta: ClientMeta) => {
  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId: profile.googleId }, { email: profile.email }] },
  });

  if (user?.deletedAt) throw new AppError(403, "This account was deleted. Please contact support.");
  if (user?.status === "BLOCKED") throw new AppError(403, "Your account has been blocked");

  let isNewUser = false;
  if (!user) {
    isNewUser = true;
    user = await prisma.user.create({
      data: {
        name: profile.name,
        email: profile.email,
        googleId: profile.googleId,
        avatar: profile.avatar,
        authProvider: "GOOGLE",
        role: "PATIENT",
      },
    });
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.USER_REGISTERED,
      entity: "User",
      entityId: user.id,
      metadata: { provider: "GOOGLE" },
      ip: meta.ip,
    });
  } else if (!user.googleId) {
    // Link Google to an existing email/password account.
    user = await prisma.user.update({
      where: { id: user.id },
      data: { googleId: profile.googleId, avatar: user.avatar ?? profile.avatar },
    });
  }

  const safe = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
    select: safeUserSelect,
  });

  await logAudit({
    actorId: safe.id,
    actorRole: safe.role,
    action: AuditAction.USER_LOGIN,
    entity: "User",
    entityId: safe.id,
    metadata: { provider: "GOOGLE" },
    ip: meta.ip,
  });

  return { isNewUser, user: safe, ...(await issueTokens(safe, meta)) };
};

const loginWithGoogleIdToken = async (idToken: string, meta: ClientMeta) =>
  loginWithGoogleProfile(await verifyGoogleIdToken(idToken), meta);

const loginWithGoogleCode = async (code: string, state: string, meta: ClientMeta) => {
  try {
    verifyOAuthState(state);
  } catch {
    throw new AppError(400, "Invalid or expired OAuth state");
  }
  return loginWithGoogleProfile(await exchangeGoogleCode(code), meta);
};

/** Refresh-token rotation with reuse detection. */
const refresh = async (refreshToken: string | undefined, meta: ClientMeta) => {
  if (!refreshToken) throw new AppError(401, "Refresh token is required");
  const payload = verifyRefreshToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
  });

  if (!stored || stored.userId !== payload.sub) throw new AppError(401, "Invalid refresh token");

  if (stored.revokedAt) {
    // A revoked token is being replayed → assume theft and kill every session of this user.
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(401, "Refresh token reuse detected. All sessions have been revoked.");
  }
  if (stored.expiresAt < new Date()) throw new AppError(401, "Refresh token has expired");

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: { id: true, email: true, role: true, status: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw new AppError(401, "Account no longer exists");
  if (user.status === "BLOCKED") throw new AppError(403, "Your account has been blocked");

  // Atomic revoke: if two requests race with the same token only one succeeds.
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw new AppError(401, "Refresh token already used");

  return issueTokens(user, meta);
};

const logout = async (refreshToken: string | undefined) => {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

const changePassword = async (userId: string, input: ChangePasswordInput, ip?: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  // Google-only accounts may set a first password without providing a current one.
  if (user.password) {
    if (!input.currentPassword) {
      throw new AppError(400, "Current password is required", [
        { path: "currentPassword", message: "Required" },
      ]);
    }
    const ok = await bcrypt.compare(input.currentPassword, user.password);
    if (!ok) throw new AppError(401, "Current password is incorrect");
  }

  const password = await bcrypt.hash(input.newPassword, config.bcryptSaltRounds);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { password } });
    // Force re-login on every other device.
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await logAudit(
      {
        actorId: userId,
        actorRole: user.role,
        action: AuditAction.USER_PASSWORD_CHANGED,
        entity: "User",
        entityId: userId,
        ip,
      },
      tx,
    );
  });
};

export const AuthService = {
  register,
  registerDriver,
  login,
  loginWithGoogleIdToken,
  loginWithGoogleCode,
  refresh,
  logout,
  changePassword,
};
