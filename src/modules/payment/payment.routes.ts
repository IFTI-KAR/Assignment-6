import { Router } from "express";
import { auth } from "../../middlewares/auth";
import { validateRequest } from "../../middlewares/validateRequest";
import { PaymentController } from "./payment.controller";
import {
  checkoutSchema,
  listPaymentsSchema,
  paymentIdSchema,
  refundSchema,
  sessionQuerySchema,
} from "./payment.validation";

// NOTE: POST /payments/webhook is mounted directly in app.ts with express.raw()
// because Stripe signature verification needs the unparsed body.
const router = Router();

router.post(
  "/checkout",
  auth("PATIENT"),
  validateRequest(checkoutSchema),
  PaymentController.createCheckout,
);

// Stripe redirect targets (public — verified server-side against Stripe)
router.get("/success", validateRequest(sessionQuerySchema), PaymentController.success);
router.get("/cancel", validateRequest(sessionQuerySchema), PaymentController.cancel);

router.get(
  "/",
  auth("PATIENT", "ADMIN"),
  validateRequest(listPaymentsSchema),
  PaymentController.list,
);
router.get(
  "/:id",
  auth("PATIENT", "ADMIN"),
  validateRequest(paymentIdSchema),
  PaymentController.getById,
);
router.post("/:id/refund", auth("ADMIN"), validateRequest(refundSchema), PaymentController.refund);

export const PaymentRoutes = router;
