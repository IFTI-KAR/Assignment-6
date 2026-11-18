import { AppError } from "../../errors/AppError";
import type { Prisma, Role } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CacheKeys, cache } from "../../lib/redis";
import { AuditAction, logAudit } from "../../utils/audit";
import { etaMinutes, roadDistanceKm } from "../../utils/geo";
import { notify } from "../../utils/notify";
import { buildMeta, getPagination } from "../../utils/pagination";
import { findNearestAvailable } from "../ambulance/ambulance.service";
import {
  ACTIVE_EMERGENCY_STATUSES,
  ADMIN_CANCELLABLE,
  calculatePriority,
  PATIENT_CANCELLABLE,
  PRIORITY_FLOOR,
  recommendAmbulanceType,
} from "./emergency.constant";
import {
  assertCanAccess,
  emergencyDetailInclude,
  emergencyListSelect,
  generateTrackingCode,
  recordStatusChange,
} from "./emergency.utils";
import type {
  CreateEmergencyInput,
  ListEmergenciesQuery,
  OverridePriorityInput,
} from "./emergency.validation";

type Requester = { id: string; role: Role };
type ReqMeta = { ip?: string | null };

const findOrThrow = async (id: string) => {
  const emergency = await prisma.emergencyRequest.findFirst({ where: { id, deletedAt: null } });
  if (!emergency) throw new AppError(404, "Emergency request not found");
  return emergency;
};

const adminIds = async () =>
  (
    await prisma.user.findMany({
      where: { role: "ADMIN", status: "ACTIVE", deletedAt: null },
      select: { id: true },
    })
  ).map((u) => u.id);

/** Patient raises an emergency → automatic triage → enters the dispatch queue. */
const create = async (patientId: string, input: CreateEmergencyInput, meta: ReqMeta) => {
  const patient = await prisma.user.findUniqueOrThrow({
    where: { id: patientId },
    select: { name: true, phone: true },
  });

  const patientPhone = input.patientPhone ?? patient.phone;
  if (!patientPhone) {
    throw new AppError(400, "A contact phone number is required", [
      { path: "patientPhone", message: "Required (no phone on your profile)" },
    ]);
  }

  // One live emergency per caller prevents duplicate/prank submissions.
  const existing = await prisma.emergencyRequest.findFirst({
    where: { patientId, status: { in: ACTIVE_EMERGENCY_STATUSES }, deletedAt: null },
    select: { trackingCode: true, status: true },
  });
  if (existing) {
    throw new AppError(
      409,
      `You already have an active emergency (${existing.trackingCode} – ${existing.status})`,
    );
  }

  const { priority, priorityScore } = calculatePriority(input);
  const requiredAmbulanceType =
    input.requiredAmbulanceType ?? recommendAmbulanceType(priority, input.patientAge);
  const admins = await adminIds();

  const emergency = await prisma.$transaction(async (tx) => {
    const created = await tx.emergencyRequest.create({
      data: {
        trackingCode: generateTrackingCode(),
        patientId,
        emergencyType: input.emergencyType,
        priority,
        priorityScore,
        patientName: input.patientName ?? patient.name,
        patientPhone,
        patientAge: input.patientAge,
        isConscious: input.isConscious,
        isBreathing: input.isBreathing,
        hasHeavyBleeding: input.hasHeavyBleeding,
        description: input.description,
        pickupAddress: input.pickupAddress,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        requiredAmbulanceType,
      },
    });
    await recordStatusChange(tx, {
      emergencyId: created.id,
      fromStatus: null,
      toStatus: "PENDING",
      changedById: patientId,
      note: `Auto-triage: ${priority} (score ${priorityScore})`,
      latitude: input.pickupLat,
      longitude: input.pickupLng,
    });
    await notify(
      {
        userIds: admins,
        type: "EMERGENCY",
        title: `🚨 New ${priority} emergency`,
        message: `${input.emergencyType} at ${input.pickupAddress} (${created.trackingCode})`,
        metadata: { emergencyId: created.id, priority },
      },
      tx,
    );
    await logAudit(
      {
        actorId: patientId,
        actorRole: "PATIENT",
        action: AuditAction.EMERGENCY_CREATED,
        entity: "EmergencyRequest",
        entityId: created.id,
        metadata: { priority, priorityScore, emergencyType: input.emergencyType },
        ip: meta.ip,
      },
      tx,
    );
    return created;
  });

  // Informational only: how quickly could help arrive right now?
  const [nearest] = await findNearestAvailable(
    { lat: input.pickupLat, lng: input.pickupLng },
    requiredAmbulanceType,
    1,
  );
  await cache.invalidate(CacheKeys.dashboard);

  return {
    ...emergency,
    nearestAvailableAmbulance: nearest
      ? { distanceKm: nearest.distanceKm, etaMinutes: nearest.etaMinutes, type: nearest.type }
      : null,
  };
};

/** Role-scoped listing with pagination, filters, date range, search and sorting. */
const list = async (user: Requester, query: ListEmergenciesQuery) => {
  const { page, limit, searchTerm, status, priority, emergencyType, fromDate, toDate, sortBy, sortOrder } =
    query;

  const where: Prisma.EmergencyRequestWhereInput = {
    deletedAt: null,
    ...(user.role === "PATIENT" && { patientId: user.id }),
    ...(user.role === "DRIVER" && { driverId: user.id }),
    ...(status && { status }),
    ...(priority && { priority }),
    ...(emergencyType && { emergencyType }),
    ...((fromDate || toDate) && {
      createdAt: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) },
    }),
    ...(searchTerm && {
      OR: [
        { trackingCode: { contains: searchTerm, mode: "insensitive" } },
        { patientName: { contains: searchTerm, mode: "insensitive" } },
        { patientPhone: { contains: searchTerm } },
        { pickupAddress: { contains: searchTerm, mode: "insensitive" } },
      ],
    }),
  };

  const [data, total] = await prisma.$transaction([
    prisma.emergencyRequest.findMany({
      where,
      select: emergencyListSelect,
      ...getPagination(page, limit),
      orderBy: [{ [sortBy]: sortOrder }, { createdAt: "desc" }],
    }),
    prisma.emergencyRequest.count({ where }),
  ]);
  return { data, meta: buildMeta(page, limit, total) };
};

/** Dispatcher queue: pending requests, most urgent first, then oldest first (FIFO within a level). */
const queue = async () => {
  const pending = await prisma.emergencyRequest.findMany({
    where: { status: "PENDING", deletedAt: null },
    orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
    select: emergencyListSelect,
  });
  const now = Date.now();
  return pending.map((e, index) => ({
    position: index + 1,
    waitingMinutes: Math.floor((now - new Date(e.createdAt).getTime()) / 60000),
    ...e,
  }));
};

/** The caller's current live emergency (patient) or current assignment (driver). */
const myActive = async (user: Requester) => {
  const emergency = await prisma.emergencyRequest.findFirst({
    where: {
      deletedAt: null,
      status: { in: ACTIVE_EMERGENCY_STATUSES },
      ...(user.role === "PATIENT" ? { patientId: user.id } : { driverId: user.id }),
    },
    include: emergencyDetailInclude,
    orderBy: { createdAt: "desc" },
  });
  if (!emergency) return null;

  let ambulanceEta: { distanceKm: number; etaMinutes: number } | null = null;
  const amb = emergency.ambulance;
  if (amb?.currentLat != null && amb.currentLng != null && ["DISPATCHED", "EN_ROUTE"].includes(emergency.status)) {
    const distanceKm = roadDistanceKm(
      { lat: amb.currentLat, lng: amb.currentLng },
      { lat: emergency.pickupLat, lng: emergency.pickupLng },
    );
    ambulanceEta = { distanceKm, etaMinutes: etaMinutes(distanceKm) };
  }
  return { ...emergency, ambulanceEta };
};

const getById = async (id: string, user: Requester) => {
  const emergency = await prisma.emergencyRequest.findFirst({
    where: { id, deletedAt: null },
    include: emergencyDetailInclude,
  });
  if (!emergency) throw new AppError(404, "Emergency request not found");
  assertCanAccess(emergency, user);
  return emergency;
};

const timeline = async (id: string, user: Requester) => {
  const emergency = await findOrThrow(id);
  assertCanAccess(emergency, user);
  return prisma.emergencyStatusLog.findMany({
    where: { emergencyId: id },
    orderBy: { createdAt: "asc" },
    include: { changedBy: { select: { id: true, name: true, role: true } } },
  });
};

/** Public, unauthenticated tracking for family members — exposes no personal medical data. */
const track = async (trackingCode: string) => {
  const e = await prisma.emergencyRequest.findFirst({
    where: { trackingCode, deletedAt: null },
    select: {
      trackingCode: true,
      status: true,
      priority: true,
      emergencyType: true,
      pickupLat: true,
      pickupLng: true,
      createdAt: true,
      dispatchedAt: true,
      pickedUpAt: true,
      atHospitalAt: true,
      completedAt: true,
      cancelledAt: true,
      ambulance: { select: { registrationNo: true, type: true, currentLat: true, currentLng: true } },
      driver: { select: { name: true, phone: true } },
      hospital: { select: { name: true, address: true, phone: true } },
      statusLogs: { orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true } },
    },
  });
  if (!e) throw new AppError(404, "No emergency found for this tracking code");

  let eta: number | null = null;
  if (e.ambulance?.currentLat != null && e.ambulance.currentLng != null && ["DISPATCHED", "EN_ROUTE"].includes(e.status)) {
    eta = etaMinutes(
      roadDistanceKm(
        { lat: e.ambulance.currentLat, lng: e.ambulance.currentLng },
        { lat: e.pickupLat, lng: e.pickupLng },
      ),
    );
  }

  const { pickupLat: _lat, pickupLng: _lng, statusLogs, ...rest } = e;
  return {
    ...rest,
    ambulanceEtaMinutes: eta,
    timeline: statusLogs.map((l) => ({ status: l.toStatus, at: l.createdAt })),
  };
};

/** Dispatcher re-triage (e.g. after a call-back). Keeps queue ordering consistent via score floor. */
const overridePriority = async (id: string, input: OverridePriorityInput, admin: Requester, meta: ReqMeta) => {
  const emergency = await findOrThrow(id);
  if (!ACTIVE_EMERGENCY_STATUSES.includes(emergency.status)) {
    throw new AppError(400, `Cannot change priority of a ${emergency.status} emergency`);
  }
  if (emergency.priority === input.priority) {
    throw new AppError(400, `Emergency is already ${input.priority}`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.emergencyRequest.update({
      where: { id },
      data: { priority: input.priority, priorityScore: PRIORITY_FLOOR[input.priority] },
      include: emergencyDetailInclude,
    });
    await recordStatusChange(tx, {
      emergencyId: id,
      fromStatus: emergency.status,
      toStatus: emergency.status,
      changedById: admin.id,
      note: `Priority changed ${emergency.priority} → ${input.priority}: ${input.reason}`,
    });
    await logAudit(
      {
        actorId: admin.id,
        actorRole: admin.role,
        action: AuditAction.EMERGENCY_PRIORITY_OVERRIDDEN,
        entity: "EmergencyRequest",
        entityId: id,
        metadata: {
          before: { priority: emergency.priority, priorityScore: emergency.priorityScore },
          after: { priority: updated.priority, priorityScore: updated.priorityScore },
          reason: input.reason,
        },
        ip: meta.ip,
      },
      tx,
    );
    return updated;
  });
};

/**
 * Cancels an emergency and, atomically, releases everything it held:
 * the ambulance goes back to AVAILABLE and any reserved hospital bed is returned.
 */
const cancel = async (id: string, reason: string, user: Requester, meta: ReqMeta) => {
  const emergency = await findOrThrow(id);
  assertCanAccess(emergency, user);

  const allowed = user.role === "ADMIN" ? ADMIN_CANCELLABLE : PATIENT_CANCELLABLE;
  if (user.role === "DRIVER") {
    throw new AppError(403, "Drivers cannot cancel emergencies; contact the dispatcher");
  }
  if (!allowed.includes(emergency.status)) {
    throw new AppError(
      409,
      `Emergency cannot be cancelled while ${emergency.status} (allowed: ${allowed.join(", ")})`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Optimistic guard: status must not have changed since we read it.
    const { count } = await tx.emergencyRequest.updateMany({
      where: { id, status: emergency.status },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    if (count === 0) throw new AppError(409, "Emergency status changed meanwhile, please refresh");

    if (emergency.ambulanceId) {
      const ambulance = await tx.ambulance.findUnique({
        where: { id: emergency.ambulanceId },
        include: { driver: { select: { isOnDuty: true } } },
      });
      await tx.ambulance.updateMany({
        where: { id: emergency.ambulanceId, status: "DISPATCHED" },
        data: { status: ambulance?.driver?.isOnDuty ? "AVAILABLE" : "OFFLINE" },
      });
    }
    if (emergency.hospitalId) {
      await tx.hospital.update({
        where: { id: emergency.hospitalId },
        data: { availableBeds: { increment: 1 } },
      });
    }

    await recordStatusChange(tx, {
      emergencyId: id,
      fromStatus: emergency.status,
      toStatus: "CANCELLED",
      changedById: user.id,
      note: reason,
    });

    const recipients = [emergency.patientId, emergency.driverId].filter(
      (u): u is string => !!u && u !== user.id,
    );
    await notify(
      {
        userIds: recipients,
        type: "TRIP_UPDATE",
        title: "Emergency cancelled",
        message: `${emergency.trackingCode} was cancelled: ${reason}`,
        metadata: { emergencyId: id },
      },
      tx,
    );
    await logAudit(
      {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.EMERGENCY_CANCELLED,
        entity: "EmergencyRequest",
        entityId: id,
        metadata: { fromStatus: emergency.status, reason },
        ip: meta.ip,
      },
      tx,
    );
    return tx.emergencyRequest.findUniqueOrThrow({ where: { id }, include: emergencyDetailInclude });
  });

  if (emergency.hospitalId) await cache.invalidate(CacheKeys.hospitals);
  await cache.invalidate(CacheKeys.dashboard);
  return result;
};

/** Admin archive (soft delete) — only closed incidents can be archived. */
const softDelete = async (id: string, admin: Requester, meta: ReqMeta) => {
  const emergency = await findOrThrow(id);
  if (!["COMPLETED", "CANCELLED"].includes(emergency.status)) {
    throw new AppError(409, "Only COMPLETED or CANCELLED emergencies can be deleted");
  }
  await prisma.emergencyRequest.update({ where: { id }, data: { deletedAt: new Date() } });
  await logAudit({
    actorId: admin.id,
    actorRole: admin.role,
    action: AuditAction.EMERGENCY_DELETED,
    entity: "EmergencyRequest",
    entityId: id,
    ip: meta.ip,
  });
};

export const EmergencyService = {
  create,
  list,
  queue,
  myActive,
  getById,
  timeline,
  track,
  overridePriority,
  cancel,
  softDelete,
};
