import { z } from "zod";
import type { PaginationMeta } from "./sendResponse";

/** Shared query schema pieces for list endpoints: ?page=1&limit=10&sortBy=createdAt&sortOrder=desc */
export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
};

export const searchTerm = z.string().trim().min(1).max(100).optional();

export const getPagination = (page: number, limit: number) => ({
  skip: (page - 1) * limit,
  take: limit,
});

export const buildMeta = (page: number, limit: number, total: number): PaginationMeta => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

/** Accepts "true"/"false" query strings and real booleans. */
export const booleanQuery = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => v === true || v === "true");
