import { type LoginTicket, OAuth2Client } from "google-auth-library";
import { config } from "../config";
import { AppError } from "../errors/AppError";

export type GoogleProfile = {
  googleId: string;
  email: string;
  name: string;
  avatar?: string;
};

const ensureConfigured = () => {
  if (!config.google.clientId) {
    throw new AppError(503, "Google login is not configured (missing GOOGLE_CLIENT_ID)");
  }
};

const getClient = () =>
  new OAuth2Client({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
  });

/** Verifies a Google ID token (from Google Identity Services / OAuth Playground / mobile SDK). */
export const verifyGoogleIdToken = async (idToken: string): Promise<GoogleProfile> => {
  ensureConfigured();
  let ticket: LoginTicket;
  try {
    ticket = await getClient().verifyIdToken({ idToken, audience: config.google.clientId });
  } catch {
    throw new AppError(401, "Invalid or expired Google token");
  }
  const data = ticket.getPayload();
  if (!data?.sub || !data.email) throw new AppError(401, "Google token is missing profile data");
  if (data.email_verified === false) throw new AppError(401, "Google email is not verified");

  return {
    googleId: data.sub,
    email: data.email.toLowerCase(),
    name: data.name ?? data.email.split("@")[0],
    avatar: data.picture,
  };
};

/** Step 1 of the redirect flow: URL of Google's consent screen. */
export const getGoogleAuthUrl = (state: string) => {
  ensureConfigured();
  if (!config.google.clientSecret) {
    throw new AppError(503, "Google login is not configured (missing GOOGLE_CLIENT_SECRET)");
  }
  return getClient().generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
    state,
  });
};

/** Step 2 of the redirect flow: exchange the `code` for tokens and verify the ID token. */
export const exchangeGoogleCode = async (code: string): Promise<GoogleProfile> => {
  ensureConfigured();
  let idToken: string | null | undefined;
  try {
    const { tokens } = await getClient().getToken(code);
    idToken = tokens.id_token;
  } catch {
    throw new AppError(401, "Failed to exchange Google authorization code");
  }
  if (!idToken) throw new AppError(401, "Google did not return an ID token");
  return verifyGoogleIdToken(idToken);
};
