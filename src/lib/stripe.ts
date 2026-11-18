import Stripe from "stripe";
import { config } from "../config";
import { AppError } from "../errors/AppError";

let stripeClient: Stripe | null = null;

export const getStripe = (): Stripe => {
  if (!config.stripe.secretKey || config.stripe.secretKey === "sk_test_xxx") {
    throw new AppError(503, "Payment gateway is not configured (missing STRIPE_SECRET_KEY)");
  }
  stripeClient ??= new Stripe(config.stripe.secretKey);
  return stripeClient;
};
