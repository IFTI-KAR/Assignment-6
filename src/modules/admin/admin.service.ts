import { AppError } from "../../errors/AppError";
import type { Prisma, Role, UserStatus } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CacheKeys, cache } from "../../lib/redis";
import { AuditAction, logAudit } from "../../utils/audit";
import { buildMeta, getPagination } from "../../utils/pagination";
import { ACTIVE_EMERGENCY_STATUSES } from "../emergency/emergency.constant";
import { safeUserSelect, userWithDriverSelect } from "../user/user.constant";
import { assertNoActiveEmergency, softDeleteUser } from "../user/user.service";
import type { AuditLogsQuery, ListUsersQuery, ReportQuery } from "./admin.validation";

type Admin = { id: string; role: Role };

// ------------------------------------------------------------------
//  User management
// ------------------------------------------------------------------

const listUsers = async (query: ListUsersQuery) => {
  const { page, limit, searchTerm, role, status, includeDeleted, sortBy, sortOrder } = query;
  const where: Prisma.UserWhereInput = {
    ...(!includeDeleted && { deletedAt: null }),
    ...(role && { role }),
    ...(status && { status }),
    ...(searchTerm && {
      OR: [
        { name: { contains: searchTerm, mode: "insensitive" } },
        { email: { contains: searchTerm, mode: "insensitive" } },
        { phone: { contains: searchTerm } },
      ],
    }),
  };
  const [data, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: { ...safeUserSelect, deletedAt: true },
      ...getPagination(page, limit),
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.user.count({ where }),
  ]);
  return { data, meta: buildMeta(page, limit, total) };
};

const getUser = async (id: string) => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...userWithDriverSelect,
      deletedAt: true,
      _count: { select: { emergencyRequests: true, assignedEmergencies: true, payments: true } },
    },
  });
  if (!user) throw new AppError(404, "User not found");
  return user;
};

const findLiveUser = async (id: string) => {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: { driverProfile: { include: { ambulance: true } } },
  });
  if (!user) throw new AppError(404, "User not found");
  return user;
};

/**
 * Role change rules:
 *  - admins cannot change their own role (prevents locking the system out);
 *  - becoming a DRIVER requires a driver profile (license) — drivers register via /auth/register/driver;
 *  - leaving DRIVER takes the driver off duty and detaches their ambulance.
 */
const changeRole = async (id: string, role: Role, admin: Admin, ip?: string) => {
  if (id === admin.id) throw new AppError(400, "You cannot change your own role");
  const user = await findLiveUser(id);
  if (user.role === role) throw new AppError(400, `User is already ${role}`);
  if (role === "DRIVER" && !user.driverProfile) {
    throw new AppError(
      400,
      "User has no driver profile/license. Drivers must register via /auth/register/driver",
    );
  }
  await assertNoActiveEmergency(id);

  return prisma.$transaction(async (tx) => {
    if (user.role === "DRIVER" && user.driverProfile) {
      await tx.driverProfile.update({
        where: { id: user.driverProfile.id },
        data: { isOnDuty: false },
      });
      if (user.driverProfile.ambulance) {
        await tx.ambulance.update({
          where: { id: user.driverProfile.ambulance.id },
          data: { driverId: null, status: "OFFLINE" },
        });
      }
    }
    const updated = await tx.user.update({ where: { id }, data: { role }, select: safeUserSelect });
    // Old access tokens carry the old role → force a fresh login.
    await tx.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await logAudit(
      {
        actorId: admin.id,
        actorRole: admin.role,
        action: AuditAction.USER_ROLE_CHANGED,
        entity: "User",
        entityId: id,
        metadata: { from: user.role, to: role },
        ip,
      },
      tx,
    );
    return updated;
  });
};

const changeStatus = async (id: string, status: UserStatus, admin: Admin, ip?: string) => {
  if (id === admin.id) throw new AppError(400, "You cannot change your own status");
  const user = await findLiveUser(id);
  if (user.status === status) throw new AppError(400, `User is already ${status}`);
  if (status === "BLOCKED") await assertNoActiveEmergency(id);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: { status },
      select: safeUserSelect,
    });
    if (status === "BLOCKED") {
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (user.driverProfile) {
        await tx.driverProfile.update({
          where: { id: user.driverProfile.id },
          data: { isOnDuty: false },
        });
        await tx.ambulance.updateMany({
          where: { driverId: user.driverProfile.id, status: "AVAILABLE" },
          data: { status: "OFFLINE" },
        });
      }
    }
    await logAudit(
      {
        actorId: admin.id,
        actorRole: admin.role,
        action: AuditAction.USER_STATUS_CHANGED,
        entity: "User",
        entityId: id,
        metadata: { from: user.status, to: status },
        ip,
      },
      tx,
    );
    return updated;
  });
};

const deleteUser = async (id: string, admin: Admin, ip?: string) => {
  if (id === admin.id) throw new AppError(400, "Use DELETE /users/me to delete your own account");
  await findLiveUser(id);
  await softDeleteUser(id, admin, ip);
};

// ------------------------------------------------------------------
//  Dashboard, analytics, audit
// ------------------------------------------------------------------

type ResponseTimeRow = {
  avg_dispatch_min: number | null;
  avg_arrival_min: number | null;
  avg_total_min: number | null;
};

const round = (n: unknown) => (n == null ? null : Math.round(Number(n) * 10) / 10);
const countMap = <K extends string>(rows: { _count: { _all: number } }[], key: (r: never) => K) =>
  Object.fromEntries(rows.map((r) => [key(r as never), r._count._all]));

/** Cached for 60 s — invalidated on dispatch / completion / payment / cancellation. */
const dashboardStats = async () =>
  cache.getOrSet(CacheKeys.dashboard, 60, async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      usersByRole,
      emergenciesByStatus,
      emergenciesByPriority,
      ambulancesByStatus,
      driversOnDuty,
      beds,
      revenue,
      todayCount,
      pendingPayments,
      responseTimes,
    ] = await Promise.all([
      prisma.user.groupBy({ by: ["role"], where: { deletedAt: null }, _count: { _all: true } }),
      prisma.emergencyRequest.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      prisma.emergencyRequest.groupBy({
        by: ["priority"],
        where: { deletedAt: null, status: { in: ACTIVE_EMERGENCY_STATUSES } },
        _count: { _all: true },
      }),
      prisma.ambulance.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      prisma.driverProfile.count({ where: { isOnDuty: true, user: { deletedAt: null } } }),
      prisma.hospital.aggregate({
        where: { deletedAt: null, isActive: true },
        _sum: { availableBeds: true, totalEmergencyBeds: true },
        _count: { _all: true },
      }),
      prisma.payment.aggregate({
        where: { status: "PAID" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.emergencyRequest.count({
        where: { deletedAt: null, createdAt: { gte: startOfToday } },
      }),
      prisma.payment.aggregate({
        where: { status: "PENDING" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.$queryRaw<ResponseTimeRow[]>`
        SELECT
          AVG(EXTRACT(EPOCH FROM ("dispatchedAt" - "createdAt")) / 60) AS avg_dispatch_min,
          AVG(EXTRACT(EPOCH FROM ("atPickupAt"  - "createdAt")) / 60) AS avg_arrival_min,
          AVG(EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) / 60) AS avg_total_min
        FROM emergency_requests
        WHERE "deletedAt" IS NULL AND status = 'COMPLETED'`,
    ]);

    const rt = responseTimes[0];
    return {
      users: countMap(usersByRole, (r: { role: string }) => r.role),
      emergencies: {
        byStatus: countMap(emergenciesByStatus, (r: { status: string }) => r.status),
        activeByPriority: countMap(emergenciesByPriority, (r: { priority: string }) => r.priority),
        today: todayCount,
      },
      fleet: {
        ambulancesByStatus: countMap(ambulancesByStatus, (r: { status: string }) => r.status),
        driversOnDuty,
      },
      hospitals: {
        active: beds._count._all,
        availableBeds: beds._sum.availableBeds ?? 0,
        totalEmergencyBeds: beds._sum.totalEmergencyBeds ?? 0,
      },
      payments: {
        revenue: Number(revenue._sum.amount ?? 0),
        paidCount: revenue._count._all,
        pendingAmount: Number(pendingPayments._sum.amount ?? 0),
        pendingCount: pendingPayments._count._all,
      },
      responseTimesMinutes: {
        avgTimeToDispatch: round(rt?.avg_dispatch_min),
        avgTimeToPatient: round(rt?.avg_arrival_min),
        avgTotalTripTime: round(rt?.avg_total_min),
      },
      generatedAt: new Date().toISOString(),
    };
  });

type DailyRow = { day: Date; total: number; completed: number; cancelled: number };
type PriorityRtRow = { priority: string; trips: number; avg_arrival_min: number | null };

/** Incident analytics for a date range (default: last 30 days). */
const emergencyReport = async ({ fromDate, toDate }: ReportQuery) => {
  const key = `${CacheKeys.reports}${fromDate.toISOString().slice(0, 13)}:${toDate.toISOString().slice(0, 13)}`;
  return cache.getOrSet(key, 300, async () => {
    const range: Prisma.EmergencyRequestWhereInput = {
      deletedAt: null,
      createdAt: { gte: fromDate, lte: toDate },
    };

    const [daily, byType, byPriority, topHospitals, revenue, arrivalByPriority] = await Promise.all(
      [
        prisma.$queryRaw<DailyRow[]>`
        SELECT date_trunc('day', "createdAt")::date AS day,
               COUNT(*)::int AS total,
               (COUNT(*) FILTER (WHERE status = 'COMPLETED'))::int AS completed,
               (COUNT(*) FILTER (WHERE status = 'CANCELLED'))::int AS cancelled
        FROM emergency_requests
        WHERE "deletedAt" IS NULL AND "createdAt" BETWEEN ${fromDate} AND ${toDate}
        GROUP BY 1 ORDER BY 1`,
        prisma.emergencyRequest.groupBy({
          by: ["emergencyType"],
          where: range,
          _count: { _all: true },
        }),
        prisma.emergencyRequest.groupBy({ by: ["priority"], where: range, _count: { _all: true } }),
        prisma.emergencyRequest.groupBy({
          by: ["hospitalId"],
          where: { ...range, hospitalId: { not: null }, status: "COMPLETED" },
          _count: { _all: true },
          orderBy: { _count: { hospitalId: "desc" } },
          take: 5,
        }),
        prisma.payment.aggregate({
          where: { status: "PAID", paidAt: { gte: fromDate, lte: toDate } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.$queryRaw<PriorityRtRow[]>`
        SELECT priority::text AS priority,
               COUNT(*)::int AS trips,
               AVG(EXTRACT(EPOCH FROM ("atPickupAt" - "createdAt")) / 60) AS avg_arrival_min
        FROM emergency_requests
        WHERE "deletedAt" IS NULL AND "atPickupAt" IS NOT NULL
          AND "createdAt" BETWEEN ${fromDate} AND ${toDate}
        GROUP BY priority`,
      ],
    );

    const hospitalIds = topHospitals
      .map((h) => h.hospitalId)
      .filter((id): id is string => id !== null);
    const hospitals = await prisma.hospital.findMany({
      where: { id: { in: hospitalIds } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(hospitals.map((h) => [h.id, h.name]));

    return {
      range: { fromDate, toDate },
      daily: daily.map((d) => ({ ...d, day: new Date(d.day).toISOString().slice(0, 10) })),
      byEmergencyType: countMap(byType, (r: { emergencyType: string }) => r.emergencyType),
      byPriority: countMap(byPriority, (r: { priority: string }) => r.priority),
      avgArrivalMinutesByPriority: arrivalByPriority.map((r) => ({
        priority: r.priority,
        trips: r.trips,
        avgArrivalMinutes: round(r.avg_arrival_min),
      })),
      topHospitals: topHospitals.map((h) => ({
        hospitalId: h.hospitalId,
        name: (h.hospitalId ? nameOf.get(h.hospitalId) : undefined) ?? "Unknown",
        completedTrips: h._count._all,
      })),
      revenue: { total: Number(revenue._sum.amount ?? 0), payments: revenue._count._all },
    };
  });
};

const auditLogs = async (query: AuditLogsQuery) => {
  const { page, limit, action, entity, entityId, actorId, fromDate, toDate } = query;
  const where: Prisma.AuditLogWhereInput = {
    ...(action && { action }),
    ...(entity && { entity }),
    ...(entityId && { entityId }),
    ...(actorId && { actorId }),
    ...((fromDate || toDate) && {
      createdAt: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) },
    }),
  };
  const [data, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true, role: true } } },
      ...getPagination(page, limit),
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { data, meta: buildMeta(page, limit, total) };
};

export const AdminService = {
  listUsers,
  getUser,
  changeRole,
  changeStatus,
  deleteUser,
  dashboardStats,
  emergencyReport,
  auditLogs,
};
