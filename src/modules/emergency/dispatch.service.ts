import { AppError } from "../../errors/AppError";
import type { AmbulanceType, EmergencyRequest, Role } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CacheKeys, cache } from "../../lib/redis";
import { config } from "../../config";
import { AuditAction, logAudit } from "../../utils/audit";
import { etaMinutes, roadDistanceKm } from "../../utils/geo";
import { notify } from "../../utils/notify";
import { findNearestAvailable } from "../ambulance/ambulance.service";
import {
  COMPATIBLE_TYPES,
  DRIVER_TRANSITIONS,
  HOSPITAL_SELECTABLE,
  STATUS_TIMESTAMP_FIELD,
} from "./emergency.constant";
import { assertCanAccess, calculateFare, emergencyDetailInclude, recordStatusChange } from "./emergency.utils";
import type { UpdateStatusInput } from "./emergency.validation";

type Requester = { id: string; role: Role };
type ReqMeta = { ip?: string | null };

/** Thrown when an ambulance was grabbed by a concurrent dispatch — the auto-dispatcher tries the next one. */
class AmbulanceUnavailableError extends AppError {
  constructor() {
    super(409, "Selected ambulance is no longer available");
  }
}

type Candidate = {
  id: string;
  driverId: string | null;
  registrationNo: string;
  type: AmbulanceType;
  driverUserId: string;
  distanceKm: number | null;
  etaMinutes: number | null;
};

/**
 * Atomic dispatch. Both rows are claimed with conditional UPDATEs inside one transaction:
 *   ambulance: AVAILABLE → DISPATCHED  (only if still available and still driven by the same driver)
 *   emergency: PENDING   → DISPATCHED  (only if still pending)
 * If either claim affects 0 rows the whole transaction rolls back, so an ambulance can never be
 * double-booked and an emergency can never receive two ambulances — even under concurrent requests.
 */
const assign = async (emergency: EmergencyRequest, c: Candidate, admin: Requester, meta: ReqMeta) =>
  prisma.$transaction(async (tx) => {
    const ambulanceClaim = await tx.ambulance.updateMany({
      where: { id: c.id, status: "AVAILABLE", deletedAt: null, driverId: c.driverId },
      data: { status: "DISPATCHED" },
    });
    if (ambulanceClaim.count === 0) throw new AmbulanceUnavailableError();

    const now = new Date();
    const emergencyClaim = await tx.emergencyRequest.updateMany({
      where: { id: emergency.id, status: "PENDING", deletedAt: null },
      data: {
        status: "DISPATCHED",
        ambulanceId: c.id,
        driverId: c.driverUserId,
        dispatcherId: admin.id,
        dispatchedAt: now,
      },
    });
    if (emergencyClaim.count === 0) {
      throw new AppError(409, "Emergency was already dispatched or cancelled");
    }

    await recordStatusChange(tx, {
      emergencyId: emergency.id,
      fromStatus: "PENDING",
      toStatus: "DISPATCHED",
      changedById: admin.id,
      note: `Ambulance ${c.registrationNo} dispatched${c.etaMinutes ? ` (ETA ~${c.etaMinutes} min)` : ""}`,
    });

    await notify(
      {
        userIds: emergency.patientId,
        type: "DISPATCH",
        title: "🚑 Ambulance dispatched",
        message: `Ambulance ${c.registrationNo} is on the way${c.etaMinutes ? `, ETA ~${c.etaMinutes} min` : ""}.`,
        metadata: { emergencyId: emergency.id, ambulanceId: c.id },
      },
      tx,
    );
    await notify(
      {
        userIds: c.driverUserId,
        type: "DISPATCH",
        title: `New ${emergency.priority} assignment`,
        message: `${emergency.emergencyType} at ${emergency.pickupAddress}. Contact: ${emergency.patientPhone}`,
        metadata: { emergencyId: emergency.id, pickupLat: emergency.pickupLat, pickupLng: emergency.pickupLng },
      },
      tx,
    );
    await logAudit(
      {
        actorId: admin.id,
        actorRole: admin.role,
        action: AuditAction.EMERGENCY_DISPATCHED,
        entity: "EmergencyRequest",
        entityId: emergency.id,
        metadata: { ambulanceId: c.id, driverId: c.driverUserId, distanceKm: c.distanceKm },
        ip: meta.ip,
      },
      tx,
    );

    return tx.emergencyRequest.findUniqueOrThrow({
      where: { id: emergency.id },
      include: emergencyDetailInclude,
    });
  });

/** Validates a dispatcher-chosen ambulance and turns it into a dispatch candidate. */
const manualCandidate = async (emergency: EmergencyRequest, ambulanceId: string): Promise<Candidate> => {
  const amb = await prisma.ambulance.findFirst({
    where: { id: ambulanceId, deletedAt: null },
    include: { driver: { include: { user: { select: { id: true, status: true, deletedAt: true } } } } },
  });
  if (!amb) throw new AppError(404, "Ambulance not found");
  if (amb.status !== "AVAILABLE") throw new AppError(409, `Ambulance is ${amb.status}, not AVAILABLE`);
  if (!amb.driver || !amb.driver.isVerified || !amb.driver.isOnDuty || amb.driver.user.status !== "ACTIVE") {
    throw new AppError(409, "Ambulance has no verified, on-duty driver");
  }
  if (emergency.requiredAmbulanceType && !COMPATIBLE_TYPES[emergency.requiredAmbulanceType].includes(amb.type)) {
    throw new AppError(
      400,
      `This emergency requires a ${emergency.requiredAmbulanceType}-capable ambulance (got ${amb.type})`,
    );
  }

  let distanceKm: number | null = null;
  if (amb.currentLat != null && amb.currentLng != null) {
    distanceKm = roadDistanceKm(
      { lat: amb.currentLat, lng: amb.currentLng },
      { lat: emergency.pickupLat, lng: emergency.pickupLng },
    );
  }
  return {
    id: amb.id,
    driverId: amb.driverId,
    registrationNo: amb.registrationNo,
    type: amb.type,
    driverUserId: amb.driver.user.id,
    distanceKm,
    etaMinutes: distanceKm != null ? etaMinutes(distanceKm) : null,
  };
};

/** Nearest compatible candidates; falls back to any type (except neonatal) if none are free. */
const autoCandidates = async (emergency: EmergencyRequest) => {
  const origin = { lat: emergency.pickupLat, lng: emergency.pickupLng };
  let fallback = false;
  let found = await findNearestAvailable(origin, emergency.requiredAmbulanceType, 5);

  if (!found.length && emergency.requiredAmbulanceType && emergency.requiredAmbulanceType !== "NEONATAL") {
    // Sending a basic unit now beats sending nothing.
    found = await findNearestAvailable(origin, null, 5);
    fallback = found.length > 0;
  }

  const candidates: Candidate[] = found.map((a) => ({
    id: a.id,
    driverId: a.driverId,
    registrationNo: a.registrationNo,
    type: a.type,
    driverUserId: a.driver!.user.id,
    distanceKm: a.distanceKm,
    etaMinutes: a.etaMinutes,
  }));
  return { candidates, fallback };
};

const dispatch = async (id: string, ambulanceId: string | undefined, admin: Requester, meta: ReqMeta) => {
  const emergency = await prisma.emergencyRequest.findFirst({ where: { id, deletedAt: null } });
  if (!emergency) throw new AppError(404, "Emergency request not found");
  if (emergency.status !== "PENDING") {
    throw new AppError(409, `Emergency is already ${emergency.status}`);
  }

  if (ambulanceId) {
    const candidate = await manualCandidate(emergency, ambulanceId);
    const result = await assign(emergency, candidate, admin, meta);
    await cache.invalidate(CacheKeys.dashboard);
    return { emergency: result, dispatch: { mode: "MANUAL", ...pickInfo(candidate), fallback: false } };
  }

  const { candidates, fallback } = await autoCandidates(emergency);
  if (!candidates.length) {
    throw new AppError(409, "No available ambulance with an on-duty driver right now; request stays in queue");
  }

  for (const candidate of candidates) {
    try {
      const result = await assign(emergency, candidate, admin, meta);
      await cache.invalidate(CacheKeys.dashboard);
      return { emergency: result, dispatch: { mode: "AUTO", ...pickInfo(candidate), fallback } };
    } catch (err) {
      if (err instanceof AmbulanceUnavailableError) continue; // lost the race → try next nearest
      throw err;
    }
  }
  throw new AppError(409, "All nearby ambulances were just taken; please retry");
};

const pickInfo = (c: Candidate) => ({
  ambulanceId: c.id,
  registrationNo: c.registrationNo,
  ambulanceType: c.type,
  distanceKm: c.distanceKm,
  etaMinutes: c.etaMinutes,
});

/** Priority-based auto-dispatch: serves the most urgent pending request that can be matched. */
const dispatchNext = async (admin: Requester, meta: ReqMeta) => {
  const pending = await prisma.emergencyRequest.findMany({
    where: { status: "PENDING", deletedAt: null },
    orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
    take: 10,
  });
  if (!pending.length) throw new AppError(404, "Dispatch queue is empty");

  for (const emergency of pending) {
    try {
      return await dispatch(emergency.id, undefined, admin, meta);
    } catch (err) {
      // No ambulance for this one (e.g. neonatal unit busy) or it was handled concurrently → next.
      if (err instanceof AppError && err.statusCode === 409) continue;
      throw err;
    }
  }
  throw new AppError(409, "No available ambulance can serve any pending emergency right now");
};

/** Driver moves the trip forward through the state machine. */
const updateStatus = async (id: string, input: UpdateStatusInput, driver: Requester, meta: ReqMeta) => {
  const emergency = await prisma.emergencyRequest.findFirst({
    where: { id, deletedAt: null },
    include: { ambulance: true, hospital: true },
  });
  if (!emergency) throw new AppError(404, "Emergency request not found");
  if (emergency.driverId !== driver.id) throw new AppError(403, "This emergency is not assigned to you");

  const expected = DRIVER_TRANSITIONS[emergency.status];
  if (!expected) throw new AppError(409, `No further driver action is possible on a ${emergency.status} trip`);
  if (input.status !== expected) {
    throw new AppError(400, `Invalid transition ${emergency.status} → ${input.status}. Next allowed: ${expected}`, [
      { path: "status", message: `Expected ${expected}` },
    ]);
  }
  if ((input.status === "AT_HOSPITAL" || input.status === "COMPLETED") && !emergency.hospital) {
    throw new AppError(400, "Select a destination hospital before arriving at the hospital");
  }

  const hasLocation = input.lat !== undefined && input.lng !== undefined;

  const result = await prisma.$transaction(async (tx) => {
    const timestampField = STATUS_TIMESTAMP_FIELD[input.status]!;
    const data: Record<string, unknown> = { status: input.status, [timestampField]: new Date() };
    let fareInfo: { distanceKm: number; fare: number } | null = null;

    if (input.status === "COMPLETED") {
      fareInfo = calculateFare(
        { lat: emergency.pickupLat, lng: emergency.pickupLng },
        { lat: emergency.hospital!.latitude, lng: emergency.hospital!.longitude },
        emergency.ambulance!,
      );
      data.distanceKm = fareInfo.distanceKm;
      data.finalFare = fareInfo.fare;
    }

    // Optimistic concurrency: only advance if nobody else changed the status meanwhile.
    const { count } = await tx.emergencyRequest.updateMany({
      where: { id, status: emergency.status },
      data,
    });
    if (count === 0) throw new AppError(409, "Trip status changed meanwhile, please refresh");

    if (hasLocation) {
      await tx.ambulance.update({
        where: { id: emergency.ambulanceId! },
        data: { currentLat: input.lat, currentLng: input.lng },
      });
      await tx.driverProfile.updateMany({
        where: { userId: driver.id },
        data: { currentLat: input.lat, currentLng: input.lng, lastLocationAt: new Date() },
      });
    }

    if (input.status === "COMPLETED" && fareInfo) {
      const profile = await tx.driverProfile.update({
        where: { userId: driver.id },
        data: {
          totalTrips: { increment: 1 },
          currentLat: emergency.hospital!.latitude,
          currentLng: emergency.hospital!.longitude,
          lastLocationAt: new Date(),
        },
      });
      // Release the ambulance at the hospital's location.
      await tx.ambulance.update({
        where: { id: emergency.ambulanceId! },
        data: {
          status: profile.isOnDuty ? "AVAILABLE" : "OFFLINE",
          currentLat: emergency.hospital!.latitude,
          currentLng: emergency.hospital!.longitude,
        },
      });
      // Bill is generated now; the patient pays it through Stripe Checkout.
      await tx.payment.create({
        data: {
          emergencyId: id,
          userId: emergency.patientId,
          amount: fareInfo.fare,
          currency: config.stripe.currency,
        },
      });
    }

    await recordStatusChange(tx, {
      emergencyId: id,
      fromStatus: emergency.status,
      toStatus: input.status,
      changedById: driver.id,
      note: input.note,
      latitude: input.lat,
      longitude: input.lng,
    });

    const messages: Record<string, string> = {
      EN_ROUTE: "Your ambulance is en route to the pickup location.",
      AT_PICKUP: "Your ambulance has arrived at the pickup location.",
      PATIENT_ONBOARD: `Patient on board, heading to ${emergency.hospital?.name ?? "hospital"}.`,
      AT_HOSPITAL: `Arrived at ${emergency.hospital?.name ?? "hospital"}.`,
      COMPLETED: `Trip completed. Fare: ${fareInfo?.fare ?? 0} ${config.stripe.currency.toUpperCase()}. Please complete the payment.`,
    };
    await notify(
      {
        userIds: emergency.patientId,
        type: input.status === "COMPLETED" ? "PAYMENT" : "TRIP_UPDATE",
        title: `Trip update: ${input.status.replaceAll("_", " ")}`,
        message: messages[input.status],
        metadata: { emergencyId: id, status: input.status },
      },
      tx,
    );
    await logAudit(
      {
        actorId: driver.id,
        actorRole: driver.role,
        action: AuditAction.EMERGENCY_STATUS_CHANGED,
        entity: "EmergencyRequest",
        entityId: id,
        metadata: { from: emergency.status, to: input.status, ...(fareInfo && { fare: fareInfo.fare }) },
        ip: meta.ip,
      },
      tx,
    );

    return tx.emergencyRequest.findUniqueOrThrow({ where: { id }, include: emergencyDetailInclude });
  });

  if (input.status === "COMPLETED") await cache.invalidate(CacheKeys.dashboard);
  return result;
};

/**
 * Choose / change the destination hospital. A bed is reserved atomically
 * (conditional decrement), and the previously reserved bed (if any) is released.
 */
const selectHospital = async (id: string, hospitalId: string, user: Requester, meta: ReqMeta) => {
  const emergency = await prisma.emergencyRequest.findFirst({
    where: { id, deletedAt: null },
    include: { ambulance: true },
  });
  if (!emergency) throw new AppError(404, "Emergency request not found");
  assertCanAccess(emergency, user);
  if (user.role === "PATIENT") throw new AppError(403, "Only the driver or dispatcher can select the hospital");

  if (!HOSPITAL_SELECTABLE.includes(emergency.status)) {
    throw new AppError(409, `Hospital cannot be selected while ${emergency.status}`);
  }
  if (emergency.hospitalId === hospitalId) throw new AppError(400, "This hospital is already selected");

  const hospital = await prisma.hospital.findFirst({ where: { id: hospitalId, deletedAt: null, isActive: true } });
  if (!hospital) throw new AppError(404, "Hospital not found or inactive");
  if (emergency.priority === "CRITICAL" && emergency.requiredAmbulanceType === "ICU" && !hospital.hasICU) {
    throw new AppError(400, "This patient needs a hospital with an ICU");
  }

  const { distanceKm, fare } = calculateFare(
    { lat: emergency.pickupLat, lng: emergency.pickupLng },
    { lat: hospital.latitude, lng: hospital.longitude },
    emergency.ambulance!,
  );

  const result = await prisma.$transaction(async (tx) => {
    const reserved = await tx.hospital.updateMany({
      where: { id: hospitalId, availableBeds: { gt: 0 }, isActive: true, deletedAt: null },
      data: { availableBeds: { decrement: 1 } },
    });
    if (reserved.count === 0) throw new AppError(409, `${hospital.name} has no free emergency beds`);

    if (emergency.hospitalId) {
      await tx.hospital.update({
        where: { id: emergency.hospitalId },
        data: { availableBeds: { increment: 1 } },
      });
    }

    const { count } = await tx.emergencyRequest.updateMany({
      where: { id, status: emergency.status },
      data: { hospitalId, distanceKm, estimatedFare: fare },
    });
    if (count === 0) throw new AppError(409, "Trip status changed meanwhile, please refresh");

    await recordStatusChange(tx, {
      emergencyId: id,
      fromStatus: emergency.status,
      toStatus: emergency.status,
      changedById: user.id,
      note: `Destination hospital set to ${hospital.name} (~${distanceKm} km, est. fare ${fare})`,
    });
    await notify(
      {
        userIds: [emergency.patientId, emergency.driverId].filter((u): u is string => !!u && u !== user.id),
        type: "TRIP_UPDATE",
        title: "Destination hospital selected",
        message: `${hospital.name}, ${hospital.address}. Estimated fare: ${fare} ${config.stripe.currency.toUpperCase()}.`,
        metadata: { emergencyId: id, hospitalId },
      },
      tx,
    );
    await logAudit(
      {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.EMERGENCY_HOSPITAL_ASSIGNED,
        entity: "EmergencyRequest",
        entityId: id,
        metadata: { previousHospitalId: emergency.hospitalId, hospitalId, distanceKm, estimatedFare: fare },
        ip: meta.ip,
      },
      tx,
    );
    return tx.emergencyRequest.findUniqueOrThrow({ where: { id }, include: emergencyDetailInclude });
  });

  await cache.invalidate(CacheKeys.hospitals);
  return result;
};

export const DispatchService = { dispatch, dispatchNext, updateStatus, selectHospital };
