import { AppError } from "../../errors/AppError";
import type { Prisma, Role } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { AuditAction, logAudit } from "../../utils/audit";
import { notify } from "../../utils/notify";
import { buildMeta, getPagination } from "../../utils/pagination";
import { ON_TRIP_STATUSES } from "../emergency/emergency.constant";
import type { ListDriversQuery, UpdateDutyInput, UpdateLocationInput } from "./driver.validation";

type Actor = { actorId: string | null; actorRole: Role | null; ip: string | null };

const driverInclude = {
  user: { select: { id: true, name: true, email: true, phone: true, avatar: true, status: true } },
  ambulance: { select: { id: true, registrationNo: true, type: true, status: true } },
} satisfies Prisma.DriverProfileInclude;

const getProfileByUserId = async (userId: string) => {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    include: { ambulance: true },
  });
  if (!profile) throw new AppError(404, "Driver profile not found");
  return profile;
};

const hasActiveTrip = (driverUserId: string) =>
  prisma.emergencyRequest.findFirst({
    where: { driverId: driverUserId, status: { in: ON_TRIP_STATUSES }, deletedAt: null },
    select: { id: true, trackingCode: true, status: true },
  });

const list = async (query: ListDriversQuery) => {
  const { page, limit, searchTerm, isVerified, isOnDuty, hasAmbulance, sortBy, sortOrder } = query;
  const where: Prisma.DriverProfileWhereInput = {
    user: { deletedAt: null, role: "DRIVER" },
    ...(isVerified !== undefined && { isVerified }),
    ...(isOnDuty !== undefined && { isOnDuty }),
    ...(hasAmbulance !== undefined && { ambulance: hasAmbulance ? { isNot: null } : { is: null } }),
    ...(searchTerm && {
      OR: [
        { licenseNumber: { contains: searchTerm, mode: "insensitive" } },
        { user: { name: { contains: searchTerm, mode: "insensitive" } } },
        { user: { email: { contains: searchTerm, mode: "insensitive" } } },
      ],
    }),
  };

  const [data, total] = await prisma.$transaction([
    prisma.driverProfile.findMany({
      where,
      include: driverInclude,
      ...getPagination(page, limit),
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.driverProfile.count({ where }),
  ]);
  return { data, meta: buildMeta(page, limit, total) };
};

const getById = async (id: string) => {
  const driver = await prisma.driverProfile.findFirst({
    where: { id, user: { deletedAt: null } },
    include: driverInclude,
  });
  if (!driver) throw new AppError(404, "Driver not found");

  const recentTrips = await prisma.emergencyRequest.findMany({
    where: { driverId: driver.userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      trackingCode: true,
      status: true,
      priority: true,
      createdAt: true,
      completedAt: true,
    },
  });
  return { ...driver, recentTrips };
};

/** Admin verifies (or revokes) a driver's license. Revoking takes the driver off the road. */
const verify = async (id: string, isVerified: boolean, actor: Actor) => {
  const driver = await prisma.driverProfile.findFirst({
    where: { id, user: { deletedAt: null } },
    include: { ambulance: true },
  });
  if (!driver) throw new AppError(404, "Driver not found");

  if (!isVerified) {
    const trip = await hasActiveTrip(driver.userId);
    if (trip)
      throw new AppError(
        409,
        `Driver is on an active trip (${trip.trackingCode}); try again later`,
      );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.driverProfile.update({
      where: { id },
      data: { isVerified, ...(!isVerified && { isOnDuty: false }) },
      include: driverInclude,
    });
    if (!isVerified && driver.ambulance?.status === "AVAILABLE") {
      await tx.ambulance.update({
        where: { id: driver.ambulance.id },
        data: { status: "OFFLINE" },
      });
    }
    await logAudit(
      {
        ...actor,
        action: AuditAction.DRIVER_VERIFIED,
        entity: "DriverProfile",
        entityId: id,
        metadata: { isVerified },
      },
      tx,
    );
    await notify(
      {
        userIds: driver.userId,
        type: "SYSTEM",
        title: isVerified ? "You're verified! ✅" : "Verification revoked",
        message: isVerified
          ? "Your driving license has been verified. You can now go on duty."
          : "Your driver verification was revoked. Please contact the dispatch center.",
      },
      tx,
    );
    return updated;
  });
};

/** Driver toggles duty; the assigned ambulance follows (AVAILABLE ⇄ OFFLINE). */
const updateDuty = async (userId: string, input: UpdateDutyInput, ip?: string) => {
  const profile = await getProfileByUserId(userId);

  if (input.isOnDuty && !profile.isVerified) {
    throw new AppError(403, "Your license has not been verified by an admin yet");
  }
  if (!input.isOnDuty) {
    const trip = await hasActiveTrip(userId);
    if (trip)
      throw new AppError(
        409,
        `Finish your active trip (${trip.trackingCode}) before going off duty`,
      );
  }

  const hasLocation = input.lat !== undefined && input.lng !== undefined;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.driverProfile.update({
      where: { id: profile.id },
      data: {
        isOnDuty: input.isOnDuty,
        ...(hasLocation && {
          currentLat: input.lat,
          currentLng: input.lng,
          lastLocationAt: new Date(),
        }),
      },
      include: driverInclude,
    });

    if (profile.ambulance) {
      const { status } = profile.ambulance;
      const nextStatus =
        input.isOnDuty && status === "OFFLINE"
          ? "AVAILABLE"
          : !input.isOnDuty && status === "AVAILABLE"
            ? "OFFLINE"
            : status;
      await tx.ambulance.update({
        where: { id: profile.ambulance.id },
        data: {
          status: nextStatus,
          ...(hasLocation && { currentLat: input.lat, currentLng: input.lng }),
        },
      });
      updated.ambulance = updated.ambulance && { ...updated.ambulance, status: nextStatus };
    }

    await logAudit(
      {
        actorId: userId,
        actorRole: "DRIVER",
        action: AuditAction.DRIVER_DUTY_CHANGED,
        entity: "DriverProfile",
        entityId: profile.id,
        metadata: { isOnDuty: input.isOnDuty },
        ip,
      },
      tx,
    );
    return {
      ...updated,
      warning: !profile.ambulance
        ? "No ambulance is assigned to you yet; you won't receive dispatches."
        : undefined,
    };
  });
};

/** Location ping from the driver app — updates both driver and ambulance coordinates. */
const updateLocation = async (userId: string, input: UpdateLocationInput) => {
  const profile = await getProfileByUserId(userId);
  const now = new Date();
  await prisma.$transaction([
    prisma.driverProfile.update({
      where: { id: profile.id },
      data: { currentLat: input.lat, currentLng: input.lng, lastLocationAt: now },
    }),
    ...(profile.ambulance
      ? [
          prisma.ambulance.update({
            where: { id: profile.ambulance.id },
            data: { currentLat: input.lat, currentLng: input.lng },
          }),
        ]
      : []),
  ]);
  return {
    lat: input.lat,
    lng: input.lng,
    lastLocationAt: now,
    ambulanceId: profile.ambulance?.id ?? null,
  };
};

/** Personal dashboard: trip counts, distance driven and fares collected. */
const mySummary = async (userId: string) => {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    include: driverInclude,
  });
  if (!profile) throw new AppError(404, "Driver profile not found");

  const [byStatus, completedAgg, activeTrip] = await Promise.all([
    prisma.emergencyRequest.groupBy({
      by: ["status"],
      where: { driverId: userId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.emergencyRequest.aggregate({
      where: { driverId: userId, status: "COMPLETED", deletedAt: null },
      _sum: { distanceKm: true, finalFare: true },
      _count: { _all: true },
    }),
    prisma.emergencyRequest.findFirst({
      where: { driverId: userId, status: { in: ON_TRIP_STATUSES }, deletedAt: null },
      include: { hospital: { select: { id: true, name: true, address: true } } },
    }),
  ]);

  return {
    profile,
    stats: {
      tripsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      completedTrips: completedAgg._count._all,
      totalDistanceKm: Number(completedAgg._sum.distanceKm ?? 0),
      totalFareGenerated: Number(completedAgg._sum.finalFare ?? 0),
    },
    activeTrip,
  };
};

export const DriverService = { list, getById, verify, updateDuty, updateLocation, mySummary };
