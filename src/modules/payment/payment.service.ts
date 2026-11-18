import type Stripe from "stripe";
import { config } from "../../config";
import { AppError } from "../../errors/AppError";
import type { Prisma, Role } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CacheKeys, cache } from "../../lib/redis";
import { getStripe } from "../../lib/stripe";
import { AuditAction, logAudit } from "../../utils/audit";
import { notify } from "../../utils/notify";
import { buildMeta, getPagination } from "../../utils/pagination";
import type { ListPaymentsQuery } from "./payment.validation";

type Requester = { id: string; role: Role; email?: string };

const paymentInclude = {
  emergency: {
    select: {
      id: true,
      trackingCode: true,
      emergencyType: true,
      status: true,
      distanceKm: true,
      completedAt: true,
      hospital: { select: { name: true } },
      ambulance: { select: { registrationNo: true, type: true } },
    },
  },
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PaymentInclude;

/** Converts a decimal amount to Stripe's smallest currency unit (poisha / cents). */
const toMinorUnit = (amount: Prisma.Decimal | number) => Math.round(Number(amount) * 100);

const intentId = (session: Stripe.Checkout.Session) =>
  typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

const gatewaySnapshot = (session: Stripe.Checkout.Session) => ({
  sessionId: session.id,
  paymentStatus: session.payment_status,
  status: session.status,
  amountTotal: session.amount_total,
  currency: session.currency,
  customerEmail: session.customer_details?.email ?? null,
});

/**
 * Step 1 — Patient starts paying the bill of a COMPLETED trip.
 * Creates (or re-uses) a Stripe Checkout Session and returns its hosted URL.
 */
const createCheckout = async (emergencyId: string, user: Requester) => {
  const payment = await prisma.payment.findUnique({
    where: { emergencyId },
    include: { emergency: { select: { patientId: true, trackingCode: true, status: true, deletedAt: true } } },
  });
  if (!payment || payment.emergency.deletedAt) {
    throw new AppError(404, "No bill found for this emergency (bills are generated when a trip completes)");
  }
  if (payment.userId !== user.id) throw new AppError(403, "This bill does not belong to you");
  if (payment.status === "PAID") throw new AppError(409, "This trip has already been paid");
  if (payment.status === "REFUNDED") throw new AppError(409, "This payment was refunded");

  const stripe = getStripe();

  // Re-use a still-open session instead of creating duplicates.
  if (payment.stripeSessionId && payment.status === "PENDING") {
    const existing = await stripe.checkout.sessions.retrieve(payment.stripeSessionId);
    if (existing.status === "open" && existing.url) {
      return { paymentId: payment.id, sessionId: existing.id, checkoutUrl: existing.url, reused: true };
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
    client_reference_id: payment.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: payment.currency,
          unit_amount: toMinorUnit(payment.amount),
          product_data: {
            name: `Ambulance trip ${payment.emergency.trackingCode}`,
            description: "Emergency ambulance service fare",
          },
        },
      },
    ],
    metadata: { paymentId: payment.id, emergencyId },
    payment_intent_data: { metadata: { paymentId: payment.id, emergencyId } },
    success_url: `${config.appUrl}/api/v1/payments/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/api/v1/payments/cancel?session_id={CHECKOUT_SESSION_ID}`,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
  });

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: { stripeSessionId: session.id, checkoutUrl: session.url, status: "PENDING", failureReason: null },
    });
    await logAudit(
      {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.PAYMENT_INITIATED,
        entity: "Payment",
        entityId: payment.id,
        metadata: { sessionId: session.id, amount: Number(payment.amount) },
      },
      tx,
    );
  });

  return { paymentId: payment.id, sessionId: session.id, checkoutUrl: session.url, reused: false };
};

const findBySession = async (session: Stripe.Checkout.Session) => {
  const paymentId = session.metadata?.paymentId ?? session.client_reference_id;
  return prisma.payment.findFirst({
    where: paymentId ? { id: paymentId } : { stripeSessionId: session.id },
    include: { emergency: { select: { trackingCode: true } } },
  });
};

/** Idempotent: safe to call from both the webhook and the success redirect. */
const markPaid = async (session: Stripe.Checkout.Session) => {
  const payment = await findBySession(session);
  if (!payment) throw new AppError(404, "Payment record not found for this session");
  if (session.payment_status !== "paid") return { payment, updated: false };

  const expected = toMinorUnit(payment.amount);
  if (session.amount_total !== expected || session.currency !== payment.currency) {
    throw new AppError(400, "Paid amount/currency does not match the bill");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { not: "PAID" } },
      data: {
        status: "PAID",
        paidAt: new Date(),
        stripeSessionId: session.id,
        stripePaymentIntentId: intentId(session),
        gatewayResponse: gatewaySnapshot(session),
        failureReason: null,
      },
    });
    if (count === 0) return false; // already processed

    await notify(
      {
        userIds: payment.userId,
        type: "PAYMENT",
        title: "Payment successful ✅",
        message: `We received ${Number(payment.amount)} ${payment.currency.toUpperCase()} for trip ${payment.emergency.trackingCode}. Thank you.`,
        metadata: { paymentId: payment.id },
      },
      tx,
    );
    await logAudit(
      {
        actorId: payment.userId,
        actorRole: "PATIENT",
        action: AuditAction.PAYMENT_SUCCEEDED,
        entity: "Payment",
        entityId: payment.id,
        metadata: { sessionId: session.id, paymentIntent: intentId(session) },
      },
      tx,
    );
    return true;
  });

  if (updated) await cache.invalidate(CacheKeys.dashboard);
  return {
    payment: await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: paymentInclude }),
    updated,
  };
};

const markUnsuccessful = async (
  session: Stripe.Checkout.Session,
  status: "FAILED" | "CANCELLED",
  reason: string,
) => {
  const payment = await findBySession(session);
  if (!payment) return null;
  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, status: "PENDING", stripeSessionId: session.id },
    data: { status, failureReason: reason, gatewayResponse: gatewaySnapshot(session) },
  });
  if (count > 0) {
    await logAudit({
      actorId: payment.userId,
      actorRole: "PATIENT",
      action: status === "FAILED" ? AuditAction.PAYMENT_FAILED : AuditAction.PAYMENT_CANCELLED,
      entity: "Payment",
      entityId: payment.id,
      metadata: { sessionId: session.id, reason },
    });
  }
  return prisma.payment.findUnique({ where: { id: payment.id }, include: paymentInclude });
};

/**
 * Step 2a — Stripe webhook (source of truth). Signature is verified against the RAW body.
 */
const handleWebhook = async (rawBody: Buffer, signature: string | undefined) => {
  if (!config.stripe.webhookSecret || config.stripe.webhookSecret === "whsec_xxx") {
    throw new AppError(503, "Stripe webhook secret is not configured");
  }
  if (!signature) throw new AppError(400, "Missing Stripe-Signature header");

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
  } catch (err) {
    throw new AppError(400, `Webhook signature verification failed: ${(err as Error).message}`);
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await markPaid(event.data.object);
      break;
    case "checkout.session.async_payment_failed":
      await markUnsuccessful(event.data.object, "FAILED", "Asynchronous payment failed");
      break;
    case "checkout.session.expired":
      await markUnsuccessful(event.data.object, "CANCELLED", "Checkout session expired");
      break;
    default:
      // Acknowledge unhandled events so Stripe doesn't retry them.
      break;
  }
  return { received: true, type: event.type };
};

/** Step 2b — Stripe success redirect: verify the session server-side (never trust the URL alone). */
const verifySuccess = async (sessionId: string) => {
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") {
    const payment = await findBySession(session);
    return { verified: false, paymentStatus: session.payment_status, paymentId: payment?.id ?? null };
  }
  const { payment } = await markPaid(session);
  return { verified: true, paymentStatus: session.payment_status, payment };
};

/** Step 2c — Stripe cancel redirect: expire the session so it can't be paid later, mark CANCELLED. */
const handleCancel = async (sessionId: string) => {
  const stripe = getStripe();
  let session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status === "open") session = await stripe.checkout.sessions.expire(sessionId);
  if (session.payment_status === "paid") return { cancelled: false, payment: (await markPaid(session)).payment };
  const payment = await markUnsuccessful(session, "CANCELLED", "Customer cancelled the checkout");
  return { cancelled: true, payment };
};

const list = async (user: Requester, query: ListPaymentsQuery) => {
  const { page, limit, status, sortBy, sortOrder } = query;
  const where: Prisma.PaymentWhereInput = {
    ...(user.role !== "ADMIN" && { userId: user.id }),
    ...(status && { status }),
  };
  const [data, total, totals] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      include: paymentInclude,
      ...getPagination(page, limit),
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { ...where, status: "PAID" }, _sum: { amount: true } }),
  ]);
  return { data, meta: buildMeta(page, limit, total), totalPaid: Number(totals._sum.amount ?? 0) };
};

const getById = async (id: string, user: Requester) => {
  const payment = await prisma.payment.findUnique({ where: { id }, include: paymentInclude });
  if (!payment) throw new AppError(404, "Payment not found");
  if (user.role !== "ADMIN" && payment.userId !== user.id) {
    throw new AppError(403, "You do not have access to this payment");
  }
  return payment;
};

/** Admin refund through Stripe (e.g. duplicate or disputed trip). */
const refund = async (id: string, reason: string, admin: Requester, ip?: string) => {
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) throw new AppError(404, "Payment not found");
  if (payment.status !== "PAID" || !payment.stripePaymentIntentId) {
    throw new AppError(409, "Only PAID payments can be refunded");
  }

  const stripeRefund = await getStripe().refunds.create({
    payment_intent: payment.stripePaymentIntentId,
    reason: "requested_by_customer",
    metadata: { paymentId: id, reason },
  });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id },
      data: {
        status: "REFUNDED",
        failureReason: reason,
        gatewayResponse: { refundId: stripeRefund.id, refundStatus: stripeRefund.status },
      },
      include: paymentInclude,
    });
    await notify(
      {
        userIds: payment.userId,
        type: "PAYMENT",
        title: "Payment refunded",
        message: `${Number(payment.amount)} ${payment.currency.toUpperCase()} has been refunded. Reason: ${reason}`,
        metadata: { paymentId: id },
      },
      tx,
    );
    await logAudit(
      {
        actorId: admin.id,
        actorRole: admin.role,
        action: AuditAction.PAYMENT_REFUNDED,
        entity: "Payment",
        entityId: id,
        metadata: { refundId: stripeRefund.id, reason },
        ip,
      },
      tx,
    );
    return updated;
  });
};

export const PaymentService = {
  createCheckout,
  handleWebhook,
  verifySuccess,
  handleCancel,
  list,
  getById,
  refund,
};
