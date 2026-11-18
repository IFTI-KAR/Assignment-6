import { z } from "zod";

export const bdPhone = z
  .string()
  .trim()
  .regex(/^(?:\+?88)?01[3-9]\d{8}$/, "Invalid Bangladeshi phone number (e.g. 01712345678)");

export const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(64, "Password must be at most 64 characters")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/\d/, "Password must contain a number");

const email = z.email("Invalid email address").trim().toLowerCase();
const name = z.string().trim().min(2, "Name must be at least 2 characters").max(80);

export const registerSchema = z.object({
  body: z.object({
    name,
    email,
    password: strongPassword,
    phone: bdPhone.optional(),
  }),
});

export const registerDriverSchema = z.object({
  body: z.object({
    name,
    email,
    password: strongPassword,
    phone: bdPhone,
    licenseNumber: z.string().trim().min(5).max(30).toUpperCase(),
    licenseExpiry: z.coerce
      .date({ error: "licenseExpiry must be a valid date (YYYY-MM-DD)" })
      .refine((d) => d > new Date(), "Driving license is expired"),
    experienceYears: z.coerce.number().int().min(0).max(50).default(0),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email,
    password: z.string().min(1, "Password is required"),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({ refreshToken: z.string().min(1).optional() }).default({}),
});

export const googleIdTokenSchema = z.object({
  body: z.object({ idToken: z.string().min(10, "Google idToken is required") }),
});

export const googleCallbackSchema = z.object({
  query: z.object({
    code: z.string().min(1, "Missing authorization code"),
    state: z.string().min(1, "Missing OAuth state"),
  }),
});

export const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z.string().min(1).optional(),
      newPassword: strongPassword,
    })
    .refine((b) => b.currentPassword !== b.newPassword, {
      message: "New password must be different from the current password",
      path: ["newPassword"],
    }),
});

export type RegisterInput = z.infer<typeof registerSchema>["body"];
export type RegisterDriverInput = z.infer<typeof registerDriverSchema>["body"];
export type LoginInput = z.infer<typeof loginSchema>["body"];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>["body"];
