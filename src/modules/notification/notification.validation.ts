import { z } from "zod";
import { booleanQuery, paginationQuery } from "../../utils/pagination";

export const listNotificationsSchema = z.object({
  query: z.object({
    page: paginationQuery.page,
    limit: paginationQuery.limit,
    isRead: booleanQuery.optional(),
    type: z.enum(["EMERGENCY", "DISPATCH", "TRIP_UPDATE", "PAYMENT", "SYSTEM"]).optional(),
  }),
});

export const notificationIdSchema = z.object({
  params: z.object({ id: z.uuid("Invalid notification id") }),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsSchema>["query"];
