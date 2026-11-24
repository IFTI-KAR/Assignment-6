import { z } from "zod";
import { booleanQuery, paginationQuery, searchTerm } from "../../utils/pagination";
import { latitude, longitude } from "../hospital/hospital.validation";

const ambulanceTypes = ["BASIC", "ADVANCED", "ICU", "NEONATAL"] as const;
const ambulanceStatuses = ["AVAILABLE", "DISPATCHED", "MAINTENANCE", "OFFLINE"] as const;
const idParam = z.object({ id: z.uuid("Invalid ambulance id") });
const money = z.coerce.number().min(0).max(100000);

const ambulanceBody = z.object({
  registrationNo: z
    .string()
    .trim()
    .toUpperCase()
    .min(4)
    .max(30)
    .regex(
      /^[A-Z0-9\- ]+$/,
      "Registration number may contain only letters, digits, spaces and dashes",
    ),
  type: z.enum(ambulanceTypes).default("BASIC"),
  equipment: z.array(z.string().trim().min(2).max(60)).max(40).default([]),
  capacity: z.coerce.number().int().min(1).max(6).default(1),
  baseFare: money,
  perKmRate: money,
  stationName: z.string().trim().min(2).max(120).optional(),
  currentLat: latitude.optional(),
  currentLng: longitude.optional(),
});

export const createAmbulanceSchema = z.object({ body: ambulanceBody });

export const updateAmbulanceSchema = z.object({
  params: idParam,
  body: ambulanceBody
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, "Provide at least one field to update"),
});

export const assignDriverSchema = z.object({
  params: idParam,
  body: z.object({
    driverProfileId: z.uuid("Invalid driver profile id").nullable(),
  }),
});

export const updateAmbulanceStatusSchema = z.object({
  params: idParam,
  body: z.object({
    status: z.enum(["AVAILABLE", "MAINTENANCE", "OFFLINE"], {
      error:
        "Status must be AVAILABLE, MAINTENANCE or OFFLINE (DISPATCHED is set by the dispatch flow)",
    }),
  }),
});

export const ambulanceIdSchema = z.object({ params: idParam });

export const listAmbulancesSchema = z.object({
  query: z.object({
    ...paginationQuery,
    searchTerm,
    type: z.enum(ambulanceTypes).optional(),
    status: z.enum(ambulanceStatuses).optional(),
    hasDriver: booleanQuery.optional(),
    sortBy: z.enum(["createdAt", "registrationNo", "baseFare", "status"]).default("createdAt"),
  }),
});

export const availableAmbulancesSchema = z.object({
  query: z.object({
    lat: latitude,
    lng: longitude,
    type: z.enum(ambulanceTypes).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(5),
  }),
});

export type CreateAmbulanceInput = z.infer<typeof createAmbulanceSchema>["body"];
export type UpdateAmbulanceInput = z.infer<typeof updateAmbulanceSchema>["body"];
export type ListAmbulancesQuery = z.infer<typeof listAmbulancesSchema>["query"];
export type AvailableAmbulancesQuery = z.infer<typeof availableAmbulancesSchema>["query"];
