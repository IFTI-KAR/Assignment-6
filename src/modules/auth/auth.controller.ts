import type { CookieOptions, Request, Response } from "express";
import { config } from "../../config";
import { getGoogleAuthUrl } from "../../lib/google";
import { requireUser } from "../../middlewares/auth";
import { signOAuthState } from "../../utils/jwt";
import { sendResponse } from "../../utils/sendResponse";
import { AuthService } from "./auth.service";

const REFRESH_COOKIE = "refreshToken";

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: config.isProduction ? "none" : "lax",
  path: "/api/v1/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get("user-agent") });

const setRefreshCookie = (res: Response, token: string) =>
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions);

/** Refresh token can come from the httpOnly cookie (browsers) or the JSON body (Postman/mobile). */
const readRefreshToken = (req: Request): string | undefined =>
  req.body?.refreshToken ?? req.cookies?.[REFRESH_COOKIE];

const register = async (req: Request, res: Response) => {
  const result = await AuthService.register(req.body, meta(req));
  setRefreshCookie(res, result.refreshToken);
  sendResponse(res, {
    statusCode: 201,
    message: "Patient account registered successfully",
    data: result,
  });
};

const registerDriver = async (req: Request, res: Response) => {
  const result = await AuthService.registerDriver(req.body, meta(req));
  setRefreshCookie(res, result.refreshToken);
  sendResponse(res, {
    statusCode: 201,
    message:
      "Driver account registered. An admin must verify your license before you can go on duty.",
    data: result,
  });
};

const login = async (req: Request, res: Response) => {
  const result = await AuthService.login(req.body, meta(req));
  setRefreshCookie(res, result.refreshToken);
  sendResponse(res, { message: "Logged in successfully", data: result });
};

const googleIdTokenLogin = async (req: Request, res: Response) => {
  const result = await AuthService.loginWithGoogleIdToken(req.body.idToken, meta(req));
  setRefreshCookie(res, result.refreshToken);
  sendResponse(res, {
    statusCode: result.isNewUser ? 201 : 200,
    message: "Logged in with Google successfully",
    data: result,
  });
};

/** Redirects the browser to Google's consent screen. */
const googleRedirect = async (_req: Request, res: Response) => {
  res.redirect(getGoogleAuthUrl(signOAuthState()));
};

const googleCallback = async (req: Request, res: Response) => {
  const { code, state } = req.query as { code: string; state: string };
  const result = await AuthService.loginWithGoogleCode(code, state, meta(req));
  setRefreshCookie(res, result.refreshToken);
  sendResponse(res, { message: "Logged in with Google successfully", data: result });
};

const refreshToken = async (req: Request, res: Response) => {
  const tokens = await AuthService.refresh(readRefreshToken(req), meta(req));
  setRefreshCookie(res, tokens.refreshToken);
  sendResponse(res, { message: "Access token refreshed", data: tokens });
};

const logout = async (req: Request, res: Response) => {
  await AuthService.logout(readRefreshToken(req));
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
  sendResponse(res, { message: "Logged out successfully" });
};

const changePassword = async (req: Request, res: Response) => {
  await AuthService.changePassword(requireUser(req).id, req.body, req.ip);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
  sendResponse(res, { message: "Password changed. Please log in again on your other devices." });
};

export const AuthController = {
  register,
  registerDriver,
  login,
  googleIdTokenLogin,
  googleRedirect,
  googleCallback,
  refreshToken,
  logout,
  changePassword,
};
