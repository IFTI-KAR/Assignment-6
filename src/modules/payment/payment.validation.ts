import { z } from "zod";
import { paginationQuery } from "../../utils/pagination";

const paymentStatuses = ["PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED"] as const;

export const checkoutSchema = z.object({
  body: z.object({ emergencyId: z.uuid("Invalid emergency id") }),
});

export const sessionQuerySchema = z.object({
  query: z.object({ session_id: z.string().startsWith("cs_", "Invalid Stripe session id") }),
});

export const paymentIdSchema = z.object({
  params: z.object({ id: z.uuid("Invalid payment id") }),
});

export const refundSchema = z.object({
  params: z.object({ id: z.uuid("Invalid payment id") }),
  body: z.object({ reason: z.string().trim().min(5).max(300) }),
});

export const listPaymentsSchema = z.object({
  query: z.object({
    ...paginationQuery,
    status: z.enum(paymentStatuses).optional(),
    sortBy: z.enum(["createdAt", "amount", "paidAt"]).default("createdAt"),
  }),
});

export type ListPaymentsQuery = z.infer<typeof listPaymentsSchema>["query"];
