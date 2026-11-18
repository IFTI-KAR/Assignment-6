import { AppError } from "../../errors/AppError";
import type { AmbulanceType, Prisma, Role } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { AuditAction, logAudit } from "../../utils/audit";
import { type Coordinates, etaMinutes, roadDistanceKm } from "../../utils/geo";
import { buildMeta, getPagination } from "../../utils/pagination";
import { COMPATIBLE_TYPES } from "../emergency/emergency.constant";
import type {
  AvailableAmbulancesQuery,
  CreateAmbulanceInput,
  ListAmbulancesQuery,
  UpdateAmbulanceInput,
} from "./ambulance.validation";

type Actor = { actorId: string | null; actorRole: Role | null; ip: string | null };

const ambulanceInclude = {
  driver: {
    select: {
      id: true,
      licenseNumber: true,
      isVerified: true,
      isOnDuty: true,
      user: { select: { id: true, name: true, phone: true, email: true } },
    },
  },
} satisfies Prisma.AmbulanceInclude;

const findActiveOrThrow = async (id: string) => {
  const ambulance = await prisma.ambulance.findFirst({ where: { id, deletedAt: null } });
  if (!ambulance) throw new AppError(404, "Ambulance not found");
  return ambulance;
};

/**
 * Dispatch candidates: AVAILABLE ambulances with a verified, on-duty driver and a known
 * location, compatible with the requested type, sorted by estimated road distance.
 */
export const findNearestAvailable = async (
  origin: Coordinates,
  requiredType: AmbulanceType | null | undefined,
  limit = 5,
) => {
  const ambulances = await prisma.ambulance.findMany({
    where: {
      deletedAt: null,
      status: "AVAILABLE",
      currentLat: { not: null },
      currentLng: { not: null },
      ...(requiredType && { type: { in: COMPATIBLE_TYPES[requiredType] } }),
      driver: { isVerified: true, isOnDuty: true, user: { deletedAt: null, status: "ACTIVE" } },
    },
    include: ambulanceInclude,
  });

  return ambulances
    .map((a) => {
      const distanceKm = roadDistanceKm(origin, { lat: a.currentLat!, lng: a.currentLng! });
      return { ...a, distanceKm, etaMinutes: etaMinutes(distanceKm) };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
};

const create = async (input: CreateAmbulanceInput, actor: Actor) => {
  const ambulance = await prisma.ambulance.create({ data: { ...input, status: "OFFLINE" } });
  await logAudit({
    ...actor,
    action: AuditAction.AMBULANCE_CREATED,
    entity: "Ambulance",
    entityId: ambulance.id,
    metadata: { registrationNo: ambulance.registrationNo, type: ambulance.type },
  });
  return ambulance;
};

const list = async (query: ListAmbulancesQuery) => {
  const { page, limit, searchTerm, type, status, hasDriver, sortBy, sortOrder } = query;
  const where: Prisma.AmbulanceWhereInput = {
    deletedAt: null,
    ...(type && { type }),
    ...(status && { status }),
    ...(hasDriver !== undefined && { driverId: hasDriver ? { not: null } : null }),
    ...(searchTerm && {
      OR: [
        { registrationNo: { contains: searchTerm, mode: "insensitive" } },
        { stationName: { contains: searchTerm, mode: "insensitive" } },
        { driver: { user: { name: { contains: searchTerm, mode: "insensitive" } } } },
      ],
    }),
  };

  const [data, total] = await prisma.$transaction([
    prisma.ambulance.findMany({
      where,
      include: ambulanceInclude,
      ...getPagination(page, limit),
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.ambulance.count({ where }),
  ]);
  return { data, meta: buildMeta(page, limit, total) };
};

const available = async (query: AvailableAmbulancesQuery) =>
  findNearestAvailable({ lat: query.lat, lng: query.lng }, query.type, query.limit);

const getById = async (id: string, requester: { id: string; role: Role }) => {
  const ambulance = await prisma.ambulance.findFirst({
    where: { id, deletedAt: null },
    include: {
      ...ambulanceInclude,
      emergencies: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, trackingCode: true, status: true, priority: true, createdAt: true },
      },
    },
  });
  if (!ambulance) throw new AppError(404, "Ambulance not found");
  if (requester.role === "DRIVER" && ambulance.driver?.user.id !== requester.id) {
    throw new AppError(403, "You can only view the ambulance assigned to you");
  }
  return ambulance;
};

const update = async (id: string, input: UpdateAmbulanceInput, actor: Actor) => {
  await findActiveOrThrow(id);
  const ambulance = await prisma.ambulance.update({ where: { id }, data: input, include: ambulanceInclude });
  await logAudit({
    ...actor,
    action: AuditAction.AMBULANCE_UPDATED,
    entity: "Ambulance",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return ambulance;
};

/** Assign / re-assign / unassign a driver. One driver ⇄ one ambulance, enforced transactionally. */
const assignDriver = async (id: string, driverProfileId: string | null, actor: Actor) => {
  return prisma.$transaction(async (tx) => {
    const ambulance = await tx.ambulance.findFirst({ where: { id, deletedAt: null } });
    if (!ambulance) throw new AppError(404, "Ambulance not found");
    if (ambulance.status === "DISPATCHED") {
      throw new AppError(409, "Cannot change the driver of an ambulance that is on an active trip");
    }

    if (driverProfileId === null) {
      const updated = await tx.ambulance.update({
        where: { id },
        data: { driverId: null, status: ambulance.status === "MAINTENANCE" ? "MAINTENANCE" : "OFFLINE" },
        include: ambulanceInclude,
      });
      await logAudit(
        {
          ...actor,
          action: AuditAction.AMBULANCE_DRIVER_ASSIGNED,
          entity: "Ambulance",
          entityId: id,
          metadata: { previousDriverId: ambulance.driverId, newDriverId: null },
        },
        tx,
      );
      return updated;
    }

    const driver = await tx.driverProfile.findUnique({
      where: { id: driverProfileId },
      include: { user: { select: { deletedAt: true, status: true, role: true } }, ambulance: true },
    });
    if (!driver || driver.user.deletedAt || driver.user.role !== "DRIVER") {
      throw new AppError(404, "Driver not found");
    }
    if (!driver.isVerified) throw new AppError(400, "Driver must be verified before assignment");
    if (driver.user.status === "BLOCKED") throw new AppError(400, "Driver account is blocked");

    if (driver.ambulance && driver.ambulance.id !== id) {
      if (driver.ambulance.status === "DISPATCHED") {
        throw new AppError(409, "Driver is currently on an active trip with another ambulance");
      }
      // Detach the driver from their previous ambulance.
      await tx.ambulance.update({
        where: { id: driver.ambulance.id },
        data: { driverId: null, status: driver.ambulance.status === "MAINTENANCE" ? "MAINTENANCE" : "OFFLINE" },
      });
    }

    const nextStatus =
      ambulance.status === "MAINTENANCE" ? "MAINTENANCE" : driver.isOnDuty ? "AVAILABLE" : "OFFLINE";

    const updated = await tx.ambulance.update({
      where: { id },
      data: { driverId: driverProfileId, status: nextStatus },
      include: ambulanceInclude,
    });

    await logAudit(
      {
        ...actor,
        action: AuditAction.AMBULANCE_DRIVER_ASSIGNED,
        entity: "Ambulance",
        entityId: id,
        metadata: { previousDriverId: ambulance.driverId, newDriverId: driverProfileId },
      },
      tx,
    );
    return updated;
  });
};

const updateStatus = async (id: string, status: "AVAILABLE" | "MAINTENANCE" | "OFFLINE", actor: Actor) => {
  const ambulance = await prisma.ambulance.findFirst({
    where: { id, deletedAt: null },
    include: { driver: true },
  });
  if (!ambulance) throw new AppError(404, "Ambulance not found");

  if (status === "AVAILABLE") {
    if (!ambulance.driver) throw new AppError(400, "Assign a driver before marking the ambulance available");
    if (!ambulance.driver.isVerified || !ambulance.driver.isOnDuty) {
      throw new AppError(400, "The assigned driver must be verified and on duty");
    }
  }

  // Conditional update prevents racing with a concurrent dispatch.
  const { count } = await prisma.ambulance.updateMany({
    where: { id, status: { not: "DISPATCHED" } },
    data: { status },
  });
  if (count === 0) throw new AppError(409, "Ambulance is on an active trip; status cannot be changed now");

  await logAudit({
    ...actor,
    action: AuditAction.AMBULANCE_STATUS_CHANGED,
    entity: "Ambulance",
    entityId: id,
    metadata: { from: ambulance.status, to: status },
  });
  return prisma.ambulance.findUniqueOrThrow({ where: { id }, include: ambulanceInclude });
};

const softDelete = async (id: string, actor: Actor) => {
  await findActiveOrThrow(id);
  const { count } = await prisma.ambulance.updateMany({
    where: { id, status: { not: "DISPATCHED" }, deletedAt: null },
    data: { deletedAt: new Date(), driverId: null, status: "OFFLINE" },
  });
  if (count === 0) throw new AppError(409, "Cannot delete an ambulance that is on an active trip");
  await logAudit({ ...actor, action: AuditAction.AMBULANCE_DELETED, entity: "Ambulance", entityId: id });
};

export const AmbulanceService = {
  create,
  list,
  available,
  getById,
  update,
  assignDriver,
  updateStatus,
  softDelete,
};
