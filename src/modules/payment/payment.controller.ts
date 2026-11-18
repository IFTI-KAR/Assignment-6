import type { Request, Response } from "express";
import { sendResponse } from "../../utils/sendResponse";
import { PaymentService } from "./payment.service";
import type { ListPaymentsQuery } from "./payment.validation";

const createCheckout = async (req: Request, res: Response) => {
  const data = await PaymentService.createCheckout(req.body.emergencyId, req.user!);
  sendResponse(res, {
    statusCode: data.reused ? 200 : 201,
    message: "Stripe checkout session created. Open checkoutUrl to pay.",
    data,
  });
};

/** Mounted with express.raw() in app.ts — req.body is a Buffer here. */
const webhook = async (req: Request, res: Response) => {
  const data = await PaymentService.handleWebhook(req.body as Buffer, req.get("stripe-signature"));
  sendResponse(res, { message: "Webhook processed", data });
};

const success = async (req: Request, res: Response) => {
  const data = await PaymentService.verifySuccess(req.query.session_id as string);
  sendResponse(res, {
    message: data.verified ? "Payment verified successfully" : "Payment not completed yet",
    data,
  });
};

const cancel = async (req: Request, res: Response) => {
  const data = await PaymentService.handleCancel(req.query.session_id as string);
  sendResponse(res, {
    message: data.cancelled ? "Payment was cancelled. You can retry from /payments/checkout." : "Payment already completed",
    data,
  });
};

const list = async (req: Request, res: Response) => {
  const { data, meta, totalPaid } = await PaymentService.list(
    req.user!,
    req.query as unknown as ListPaymentsQuery,
  );
  sendResponse(res, { message: "Payments retrieved successfully", data: { totalPaid, payments: data }, meta });
};

const getById = async (req: Request, res: Response) => {
  const data = await PaymentService.getById(req.params.id as string, req.user!);
  sendResponse(res, { message: "Payment retrieved successfully", data });
};

const refund = async (req: Request, res: Response) => {
  const data = await PaymentService.refund(req.params.id as string, req.body.reason, req.user!, req.ip);
  sendResponse(res, { message: "Payment refunded", data });
};

export const PaymentController = { createCheckout, webhook, success, cancel, list, getById, refund };
