import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";
import type { Role } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthUser } from "../types/express";
import { verifyAccessToken } from "../utils/jwt";

export const requireUser = (req: Request): AuthUser => {
  if (!req.user) throw new AppError(401, "Unauthorized");
  return req.user;
};

/**
 * Bearer-token authentication + role-based authorization.
 *   router.get("/", auth(), ...)                 → any logged-in user
 *   router.post("/", auth("ADMIN"), ...)         → admins only
 *   router.patch("/", auth("DRIVER","ADMIN"), ...)
 */
export const auth =
  (...allowedRoles: Role[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(401, "Unauthorized: missing Bearer token");
    }

    const token = header.slice(7).trim();
    const payload = verifyAccessToken(token); // throws JsonWebTokenError / TokenExpiredError → 401

    // Always re-check the DB so blocked/deleted users or changed roles take effect immediately.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, status: true, deletedAt: true },
    });

    if (!user || user.deletedAt) throw new AppError(401, "Unauthorized: account no longer exists");
    if (user.status === "BLOCKED") throw new AppError(403, "Your account has been blocked");

    if (allowedRoles.length && !allowedRoles.includes(user.role)) {
      throw new AppError(403, `Forbidden: requires role ${allowedRoles.join(" or ")}`);
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    };
    next();
  };
