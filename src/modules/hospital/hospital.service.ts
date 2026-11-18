import { AppError } from "../../errors/AppError";
import type { Prisma, Role } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CacheKeys, cache } from "../../lib/redis";
import { AuditAction, logAudit } from "../../utils/audit";
import { etaMinutes, roadDistanceKm } from "../../utils/geo";
import { buildMeta, getPagination } from "../../utils/pagination";
import { ACTIVE_EMERGENCY_STATUSES } from "../emergency/emergency.constant";
import type {
  CreateHospitalInput,
  ListHospitalsQuery,
  NearbyHospitalsQuery,
  UpdateBedsInput,
  UpdateHospitalInput,
} from "./hospital.validation";

type Actor = { actorId: string | null; actorRole: Role | null; ip: string | null };

const HOSPITAL_CACHE_TTL = 120;

const findActiveOrThrow = async (id: string) => {
  const hospital = await prisma.hospital.findFirst({ where: { id, deletedAt: null } });
  if (!hospital) throw new AppError(404, "Hospital not found");
  return hospital;
};

const create = async (input: CreateHospitalInput, actor: Actor) => {
  const hospital = await prisma.hospital.create({ data: input });
  await logAudit({ ...actor, action: AuditAction.HOSPITAL_CREATED, entity: "Hospital", entityId: hospital.id });
  await cache.invalidate(CacheKeys.hospitals);
  return hospital;
};

/** Paginated, filterable, searchable hospital directory (Redis read-through cache). */
const list = async (query: ListHospitalsQuery) => {
  const cacheKey = `${CacheKeys.hospitals}list:${JSON.stringify(query)}`;

  return cache.getOrSet(cacheKey, HOSPITAL_CACHE_TTL, async () => {
    const { page, limit, searchTerm, city, hasICU, hasAvailableBeds, specialty, sortBy, sortOrder } =
      query;

    const where: Prisma.HospitalWhereInput = {
      deletedAt: null,
      isActive: true,
      ...(city && { city: { equals: city, mode: "insensitive" } }),
      ...(hasICU !== undefined && { hasICU }),
      ...(hasAvailableBeds && { availableBeds: { gt: 0 } }),
      ...(specialty && { specialties: { has: specialty } }),
      ...(searchTerm && {
        OR: [
          { name: { contains: searchTerm, mode: "insensitive" } },
          { address: { contains: searchTerm, mode: "insensitive" } },
          { city: { contains: searchTerm, mode: "insensitive" } },
        ],
      }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.hospital.findMany({
        where,
        ...getPagination(page, limit),
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.hospital.count({ where }),
    ]);

    return { meta: buildMeta(page, limit, total), data };
  });
};

/** Hospitals with free emergency beds, ordered by estimated road distance from a point. */
const nearby = async (query: NearbyHospitalsQuery) => {
  const hospitals = await prisma.hospital.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      availableBeds: { gt: 0 },
      ...(query.needsICU && { hasICU: true }),
    },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      phone: true,
      latitude: true,
      longitude: true,
      availableBeds: true,
      hasICU: true,
      specialties: true,
    },
  });

  const origin = { lat: query.lat, lng: query.lng };
  return hospitals
    .map((h) => {
      const distanceKm = roadDistanceKm(origin, { lat: h.latitude, lng: h.longitude });
      return { ...h, distanceKm, etaMinutes: etaMinutes(distanceKm) };
    })
    .filter((h) => h.distanceKm <= query.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, query.limit);
};

const getById = async (id: string) => {
  const hospital = await prisma.hospital.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: {
        select: { emergencies: { where: { status: { in: ACTIVE_EMERGENCY_STATUSES } } } },
      },
    },
  });
  if (!hospital) throw new AppError(404, "Hospital not found");
  const { _count, ...rest } = hospital;
  return { ...rest, incomingEmergencies: _count.emergencies };
};

const update = async (id: string, input: UpdateHospitalInput, actor: Actor) => {
  await findActiveOrThrow(id);
  const hospital = await prisma.hospital.update({ where: { id }, data: input });
  await logAudit({
    ...actor,
    action: AuditAction.HOSPITAL_UPDATED,
    entity: "Hospital",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  await cache.invalidate(CacheKeys.hospitals);
  return hospital;
};

const updateBeds = async (id: string, input: UpdateBedsInput, actor: Actor) => {
  const current = await findActiveOrThrow(id);
  const total = input.totalEmergencyBeds ?? current.totalEmergencyBeds;
  if (input.availableBeds > total) {
    throw new AppError(400, "availableBeds cannot exceed totalEmergencyBeds", [
      { path: "availableBeds", message: `Must be ≤ ${total}` },
    ]);
  }
  const hospital = await prisma.hospital.update({
    where: { id },
    data: { availableBeds: input.availableBeds, totalEmergencyBeds: total },
  });
  await logAudit({
    ...actor,
    action: AuditAction.HOSPITAL_BEDS_UPDATED,
    entity: "Hospital",
    entityId: id,
    metadata: {
      before: { availableBeds: current.availableBeds, totalEmergencyBeds: current.totalEmergencyBeds },
      after: { availableBeds: hospital.availableBeds, totalEmergencyBeds: hospital.totalEmergencyBeds },
    },
  });
  await cache.invalidate(CacheKeys.hospitals);
  return hospital;
};

const softDelete = async (id: string, actor: Actor) => {
  await findActiveOrThrow(id);
  const incoming = await prisma.emergencyRequest.count({
    where: { hospitalId: id, status: { in: ACTIVE_EMERGENCY_STATUSES }, deletedAt: null },
  });
  if (incoming > 0) {
    throw new AppError(409, `Cannot delete: ${incoming} active emergency trip(s) are heading to this hospital`);
  }
  await prisma.hospital.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await logAudit({ ...actor, action: AuditAction.HOSPITAL_DELETED, entity: "Hospital", entityId: id });
  await cache.invalidate(CacheKeys.hospitals);
};

export const HospitalService = { create, list, nearby, getById, update, updateBeds, softDelete };
