import crypto from "node:crypto";
import { AppError } from "../../errors/AppError";
import type { EmergencyStatus, Prisma, Role } from "../../generated/prisma/client";
import type { TxClient } from "../../lib/prisma";
import { type Coordinates, roadDistanceKm } from "../../utils/geo";

/** EMR-YYYYMMDD-XXXXXX — human friendly, shareable with family members for public tracking. */
export const generateTrackingCode = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `EMR-${date}-${suffix}`;
};

/**
 * Fare = baseFare + perKmRate × road distance (pickup → hospital),
 * never less than the base fare, rounded to the nearest taka.
 */
export const calculateFare = (
  pickup: Coordinates,
  hospital: Coordinates,
  rates: { baseFare: Prisma.Decimal | number; perKmRate: Prisma.Decimal | number },
) => {
  const distanceKm = roadDistanceKm(pickup, hospital);
  const base = Number(rates.baseFare);
  const perKm = Number(rates.perKmRate);
  const fare = Math.round(Math.max(base, base + perKm * distanceKm));
  return { distanceKm, fare };
};

type StatusLogInput = {
  emergencyId: string;
  fromStatus: EmergencyStatus | null;
  toStatus: EmergencyStatus;
  changedById?: string | null;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

/** Appends an entry to the incident timeline (always inside the caller's transaction). */
export const recordStatusChange = (tx: TxClient, input: StatusLogInput) =>
  tx.emergencyStatusLog.create({
    data: {
      emergencyId: input.emergencyId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      changedById: input.changedById ?? null,
      note: input.note ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    },
  });

/** Row-level access rule: admins see everything, patients their own, drivers their assignments. */
export const assertCanAccess = (
  emergency: { patientId: string; driverId: string | null },
  user: { id: string; role: Role },
) => {
  if (user.role === "ADMIN") return;
  if (user.role === "PATIENT" && emergency.patientId === user.id) return;
  if (user.role === "DRIVER" && emergency.driverId === user.id) return;
  throw new AppError(403, "You do not have access to this emergency");
};

export const emergencyListSelect = {
  id: true,
  trackingCode: true,
  emergencyType: true,
  priority: true,
  priorityScore: true,
  status: true,
  patientName: true,
  patientPhone: true,
  pickupAddress: true,
  pickupLat: true,
  pickupLng: true,
  estimatedFare: true,
  finalFare: true,
  createdAt: true,
  dispatchedAt: true,
  completedAt: true,
  ambulance: { select: { id: true, registrationNo: true, type: true } },
  hospital: { select: { id: true, name: true } },
  driver: { select: { id: true, name: true, phone: true } },
  payment: { select: { id: true, status: true, amount: true } },
} satisfies Prisma.EmergencyRequestSelect;

export const emergencyDetailInclude = {
  patient: { select: { id: true, name: true, email: true, phone: true } },
  driver: { select: { id: true, name: true, phone: true, avatar: true } },
  dispatcher: { select: { id: true, name: true } },
  ambulance: {
    select: {
      id: true,
      registrationNo: true,
      type: true,
      status: true,
      currentLat: true,
      currentLng: true,
      baseFare: true,
      perKmRate: true,
    },
  },
  hospital: {
    select: { id: true, name: true, address: true, phone: true, latitude: true, longitude: true },
  },
  payment: { select: { id: true, status: true, amount: true, currency: true, paidAt: true } },
  statusLogs: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      latitude: true,
      longitude: true,
      createdAt: true,
      changedBy: { select: { id: true, name: true, role: true } },
    },
  },
} satisfies Prisma.EmergencyRequestInclude;
