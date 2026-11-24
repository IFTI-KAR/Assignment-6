import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Application } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config";
import { AppError } from "./errors/AppError";
import { prisma } from "./lib/prisma";
import { cache } from "./lib/redis";
import { globalErrorHandler } from "./middlewares/globalErrorHandler";
import { notFound } from "./middlewares/notFound";
import { globalLimiter } from "./middlewares/rateLimiter";
import { PaymentController } from "./modules/payment/payment.controller";
import router from "./routes";

const app: Application = express();

// Behind Vercel / Render proxies — required for correct req.ip & rate limiting.
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow server-to-server tools (Postman, curl) that send no Origin header.
      if (!origin || !config.corsOrigins.length || config.corsOrigins.includes(origin)) {
        return cb(null, true);
      }
      cb(null, false);
    },
    credentials: true,
  }),
);
app.use(morgan(config.isProduction ? "combined" : "dev"));

// Stripe webhook MUST receive the raw body for signature verification → mount before express.json().
app.post(
  "/api/v1/payments/webhook",
  express.raw({ type: "application/json" }),
  PaymentController.webhook,
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "🚑 Emergency Ambulance Dispatch API is running",
    data: { version: "v1", docs: "/api/v1/health", environment: config.env },
  });
});

app.get("/api/v1/health", async (_req, res) => {
  if (!config.databaseUrl) {
    throw new AppError(
      503,
      "Database is not configured (set DATABASE_URL in environment variables)",
    );
  }
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  res.json({
    success: true,
    message: "Service healthy",
    data: {
      database: "connected",
      cache: cache.isEnabled() ? "connected" : "disabled",
      dbLatencyMs: Date.now() - started,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

app.use("/api/v1", globalLimiter, router);

app.use(notFound);
app.use(globalErrorHandler);

export default app;
