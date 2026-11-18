import { z } from "zod";
import { bdPhone } from "../auth/auth.validation";

export const updateMeSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).max(80).optional(),
      phone: bdPhone.optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, "Provide at least one field to update"),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>["body"];
