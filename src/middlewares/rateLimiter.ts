import rateLimit from "express-rate-limit";

const make = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({ success: false, message, errors: [] });
    },
  });

/** Global limiter for all /api routes. */
export const globalLimiter = make(15 * 60 * 1000, 500, "Too many requests, please try again later");

/** Brute-force protection for login / register / token endpoints. */
export const authLimiter = make(
  15 * 60 * 1000,
  30,
  "Too many authentication attempts, please try again in 15 minutes",
);

/** Prevents spam/prank emergency requests. */
export const emergencyLimiter = make(
  10 * 60 * 1000,
  10,
  "Too many emergency requests from this IP, please call the hotline directly",
);
