import { Router } from "express";
import { auth } from "../../middlewares/auth";
import { authLimiter } from "../../middlewares/rateLimiter";
import { validateRequest } from "../../middlewares/validateRequest";
import { AuthController } from "./auth.controller";
import {
  changePasswordSchema,
  googleCallbackSchema,
  googleIdTokenSchema,
  loginSchema,
  refreshTokenSchema,
  registerDriverSchema,
  registerSchema,
} from "./auth.validation";

const router = Router();

router.post("/register", authLimiter, validateRequest(registerSchema), AuthController.register);
router.post(
  "/register/driver",
  authLimiter,
  validateRequest(registerDriverSchema),
  AuthController.registerDriver,
);
router.post("/login", authLimiter, validateRequest(loginSchema), AuthController.login);
router.post(
  "/refresh-token",
  authLimiter,
  validateRequest(refreshTokenSchema),
  AuthController.refreshToken,
);
router.post("/logout", validateRequest(refreshTokenSchema), AuthController.logout);

// Google (GCP) social login — ID-token flow (SPA / mobile / Postman)
router.post(
  "/google",
  authLimiter,
  validateRequest(googleIdTokenSchema),
  AuthController.googleIdTokenLogin,
);
// Google (GCP) social login — server-side OAuth redirect flow
router.get("/google", AuthController.googleRedirect);
router.get(
  "/google/callback",
  validateRequest(googleCallbackSchema),
  AuthController.googleCallback,
);

router.patch(
  "/change-password",
  auth(),
  validateRequest(changePasswordSchema),
  AuthController.changePassword,
);

export const AuthRoutes = router;
