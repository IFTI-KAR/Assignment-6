import { z } from "zod";
import { booleanQuery, paginationQuery, searchTerm } from "../../utils/pagination";
import { bdPhone } from "../auth/auth.validation";

export const latitude = z.coerce.number().min(-90).max(90);
export const longitude = z.coerce.number().min(-180).max(180);
const idParam = z.object({ id: z.uuid("Invalid hospital id") });

const hospitalBody = z.object({
  name: z.string().trim().min(3).max(120),
  address: z.string().trim().min(5).max(255),
  city: z.string().trim().min(2).max(60),
  phone: bdPhone,
  latitude,
  longitude,
  totalEmergencyBeds: z.coerce.number().int().min(0).max(5000),
  availableBeds: z.coerce.number().int().min(0).max(5000),
  hasICU: z.boolean().default(false),
  specialties: z.array(z.string().trim().min(2).max(60)).max(30).default([]),
  isActive: z.boolean().default(true),
});

export const createHospitalSchema = z.object({
  body: hospitalBody.refine((b) => b.availableBeds <= b.totalEmergencyBeds, {
    message: "availableBeds cannot exceed totalEmergencyBeds",
    path: ["availableBeds"],
  }),
});

export const updateHospitalSchema = z.object({
  params: idParam,
  body: hospitalBody
    .omit({ availableBeds: true, totalEmergencyBeds: true })
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, "Provide at least one field to update"),
});

export const updateBedsSchema = z.object({
  params: idParam,
  body: z
    .object({
      availableBeds: z.coerce.number().int().min(0).max(5000),
      totalEmergencyBeds: z.coerce.number().int().min(0).max(5000).optional(),
    })
    .strict(),
});

export const hospitalIdSchema = z.object({ params: idParam });

export const listHospitalsSchema = z.object({
  query: z.object({
    ...paginationQuery,
    searchTerm,
    city: z.string().trim().optional(),
    hasICU: booleanQuery.optional(),
    hasAvailableBeds: booleanQuery.optional(),
    specialty: z.string().trim().optional(),
    sortBy: z.enum(["name", "availableBeds", "createdAt", "city"]).default("name"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
  }),
});

export const nearbyHospitalsSchema = z.object({
  query: z.object({
    lat: latitude,
    lng: longitude,
    needsICU: booleanQuery.optional(),
    radiusKm: z.coerce.number().positive().max(200).default(25),
    limit: z.coerce.number().int().min(1).max(20).default(5),
  }),
});

export type CreateHospitalInput = z.infer<typeof createHospitalSchema>["body"];
export type UpdateHospitalInput = z.infer<typeof updateHospitalSchema>["body"];
export type UpdateBedsInput = z.infer<typeof updateBedsSchema>["body"];
export type ListHospitalsQuery = z.infer<typeof listHospitalsSchema>["query"];
export type NearbyHospitalsQuery = z.infer<typeof nearbyHospitalsSchema>["query"];
