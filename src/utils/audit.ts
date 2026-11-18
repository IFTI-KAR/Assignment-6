import type { Request } from "express";
import type { Prisma, Role } from "../generated/prisma/client";
import { type DbClient, prisma } from "../lib/prisma";

export const AuditAction = {
  USER_REGISTERED: "USER_REGISTERED",
  USER_LOGIN: "USER_LOGIN",
  USER_PROFILE_UPDATED: "USER_PROFILE_UPDATED",
  USER_PASSWORD_CHANGED: "USER_PASSWORD_CHANGED",
  USER_ROLE_CHANGED: "USER_ROLE_CHANGED",
  USER_STATUS_CHANGED: "USER_STATUS_CHANGED",
  USER_DELETED: "USER_DELETED",
  DRIVER_VERIFIED: "DRIVER_VERIFIED",
  DRIVER_DUTY_CHANGED: "DRIVER_DUTY_CHANGED",
  AMBULANCE_CREATED: "AMBULANCE_CREATED",
  AMBULANCE_UPDATED: "AMBULANCE_UPDATED",
  AMBULANCE_DRIVER_ASSIGNED: "AMBULANCE_DRIVER_ASSIGNED",
  AMBULANCE_STATUS_CHANGED: "AMBULANCE_STATUS_CHANGED",
  AMBULANCE_DELETED: "AMBULANCE_DELETED",
  HOSPITAL_CREATED: "HOSPITAL_CREATED",
  HOSPITAL_UPDATED: "HOSPITAL_UPDATED",
  HOSPITAL_BEDS_UPDATED: "HOSPITAL_BEDS_UPDATED",
  HOSPITAL_DELETED: "HOSPITAL_DELETED",
  EMERGENCY_CREATED: "EMERGENCY_CREATED",
  EMERGENCY_DISPATCHED: "EMERGENCY_DISPATCHED",
  EMERGENCY_STATUS_CHANGED: "EMERGENCY_STATUS_CHANGED",
  EMERGENCY_HOSPITAL_ASSIGNED: "EMERGENCY_HOSPITAL_ASSIGNED",
  EMERGENCY_PRIORITY_OVERRIDDEN: "EMERGENCY_PRIORITY_OVERRIDDEN",
  EMERGENCY_CANCELLED: "EMERGENCY_CANCELLED",
  EMERGENCY_DELETED: "EMERGENCY_DELETED",
  PAYMENT_INITIATED: "PAYMENT_INITIATED",
  PAYMENT_SUCCEEDED: "PAYMENT_SUCCEEDED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_CANCELLED: "PAYMENT_CANCELLED",
  PAYMENT_REFUNDED: "PAYMENT_REFUNDED",
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

type AuditInput = {
  actorId?: string | null;
  actorRole?: Role | null;
  action: AuditActionType;
  entity: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
};

/** Records who did what. Pass `tx` to make the log part of the same DB transaction. */
export const logAudit = async (input: AuditInput, db: DbClient = prisma) => {
  await db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
      ip: input.ip ?? null,
    },
  });
};

/** Convenience: pulls actor + IP from the authenticated request. */
export const auditContext = (req: Request) => ({
  actorId: req.user?.id ?? null,
  actorRole: req.user?.role ?? null,
  ip: req.ip ?? null,
});
