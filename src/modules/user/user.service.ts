import { AppError } from "../../errors/AppError";
import type { Role } from "../../generated/prisma/client";
import { uploadImageBuffer } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import { AuditAction, logAudit } from "../../utils/audit";
import { ACTIVE_EMERGENCY_STATUSES } from "../emergency/emergency.constant";
import { userWithDriverSelect } from "./user.constant";
import type { UpdateMeInput } from "./user.validation";

const getMe = async (userId: string) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      ...userWithDriverSelect,
      _count: { select: { emergencyRequests: true, assignedEmergencies: true } },
    },
  });
  const unreadNotifications = await prisma.notification.count({ where: { userId, isRead: false } });
  return { ...user, unreadNotifications };
};

const updateMe = async (userId: string, input: UpdateMeInput, ip?: string) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: input,
    select: userWithDriverSelect,
  });
  await logAudit({
    actorId: userId,
    actorRole: user.role,
    action: AuditAction.USER_PROFILE_UPDATED,
    entity: "User",
    entityId: userId,
    metadata: { fields: Object.keys(input) },
    ip,
  });
  return user;
};

const updateAvatar = async (userId: string, file: Express.Multer.File | undefined) => {
  if (!file) {
    throw new AppError(400, "Avatar image is required", [{ path: "avatar", message: "Required" }]);
  }
  const uploaded = await uploadImageBuffer(file.buffer, "ambulance-dispatch/avatars", userId);
  return prisma.user.update({
    where: { id: userId },
    data: { avatar: uploaded.secure_url },
    select: userWithDriverSelect,
  });
};

/**
 * Guards shared by self-delete, admin delete, blocking and role changes:
 * a user who is part of a live emergency cannot be removed from the system.
 */
export const assertNoActiveEmergency = async (userId: string) => {
  const active = await prisma.emergencyRequest.findFirst({
    where: {
      deletedAt: null,
      status: { in: ACTIVE_EMERGENCY_STATUSES },
      OR: [{ patientId: userId }, { driverId: userId }],
    },
    select: { trackingCode: true, status: true },
  });
  if (active) {
    throw new AppError(
      409,
      `User is involved in an active emergency (${active.trackingCode} – ${active.status})`,
    );
  }
};

/** Soft delete + revoke sessions + release ambulance (for drivers) in one transaction. */
export const softDeleteUser = async (
  userId: string,
  actor: { id: string; role: Role },
  ip?: string,
) => {
  await assertNoActiveEmergency(userId);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: "BLOCKED" },
      select: { id: true, role: true, driverProfile: { select: { id: true } } },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (user.driverProfile) {
      await tx.driverProfile.update({
        where: { id: user.driverProfile.id },
        data: { isOnDuty: false },
      });
      await tx.ambulance.updateMany({
        where: { driverId: user.driverProfile.id },
        data: { driverId: null, status: "OFFLINE" },
      });
    }
    await logAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.USER_DELETED,
        entity: "User",
        entityId: userId,
        metadata: { self: actor.id === userId },
        ip,
      },
      tx,
    );
  });
};

const deleteMe = async (userId: string, role: Role, ip?: string) =>
  softDeleteUser(userId, { id: userId, role }, ip);

export const UserService = { getMe, updateMe, updateAvatar, deleteMe };
