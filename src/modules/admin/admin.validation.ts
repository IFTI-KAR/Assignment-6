import { z } from "zod";
import { booleanQuery, paginationQuery, searchTerm } from "../../utils/pagination";

const roles = ["PATIENT", "DRIVER", "ADMIN"] as const;
const userIdParam = z.object({ id: z.uuid("Invalid user id") });

export const listUsersSchema = z.object({
  query: z.object({
    ...paginationQuery,
    searchTerm,
    role: z.enum(roles).optional(),
    status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
    includeDeleted: booleanQuery.optional(),
    sortBy: z.enum(["createdAt", "name", "email", "lastLoginAt"]).default("createdAt"),
  }),
});

export const userIdSchema = z.object({ params: userIdParam });

export const changeRoleSchema = z.object({
  params: userIdParam,
  body: z.object({ role: z.enum(roles, { error: "role must be PATIENT, DRIVER or ADMIN" }) }),
});

export const changeStatusSchema = z.object({
  params: userIdParam,
  body: z.object({ status: z.enum(["ACTIVE", "BLOCKED"], { error: "status must be ACTIVE or BLOCKED" }) }),
});

export const auditLogsSchema = z.object({
  query: z.object({
    page: paginationQuery.page,
    limit: paginationQuery.limit,
    action: z.string().trim().toUpperCase().optional(),
    entity: z.string().trim().optional(),
    entityId: z.string().trim().optional(),
    actorId: z.uuid().optional(),
    fromDate: z.coerce.date().optional(),
    toDate: z.coerce.date().optional(),
  }),
});

export const reportSchema = z.object({
  query: z
    .object({
      fromDate: z.coerce.date().default(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      toDate: z.coerce.date().default(() => new Date()),
    })
    .refine((q) => q.fromDate <= q.toDate, { message: "fromDate must be before toDate", path: ["fromDate"] }),
});

export type ListUsersQuery = z.infer<typeof listUsersSchema>["query"];
export type AuditLogsQuery = z.infer<typeof auditLogsSchema>["query"];
export type ReportQuery = z.infer<typeof reportSchema>["query"];
