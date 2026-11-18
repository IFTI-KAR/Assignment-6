import crypto from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "../config";
import type { Role } from "../generated/prisma/client";

export type AccessTokenPayload = { sub: string; email: string; role: Role };
export type RefreshTokenPayload = { sub: string; jti: string };

export const signAccessToken = (payload: AccessTokenPayload) =>
  jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn as SignOptions["expiresIn"],
  });

export const signRefreshToken = (payload: RefreshTokenPayload) =>
  jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as SignOptions["expiresIn"],
  });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, config.jwt.accessSecret) as jwt.JwtPayload & AccessTokenPayload;

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, config.jwt.refreshSecret) as jwt.JwtPayload & RefreshTokenPayload;

/** Refresh tokens are stored hashed, so a DB leak never exposes usable tokens. */
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Signed, short-lived "state" for the Google OAuth redirect flow (CSRF protection). */
export const signOAuthState = () =>
  jwt.sign({ nonce: crypto.randomUUID() }, config.jwt.accessSecret, { expiresIn: "10m" });

export const verifyOAuthState = (state: string) => jwt.verify(state, config.jwt.accessSecret);
