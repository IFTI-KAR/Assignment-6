import { z } from "zod";
import { paginationQuery, searchTerm } from "../../utils/pagination";
import { bdPhone } from "../auth/auth.validation";
import { latitude, longitude } from "../hospital/hospital.validation";

const emergencyTypes = [
  "CARDIAC",
  "STROKE",
  "RESPIRATORY",
  "ACCIDENT",
  "TRAUMA",
  "MATERNITY",
  "BURN",
  "POISONING",
  "OTHER",
] as const;
const priorities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const statuses = [
  "PENDING",
  "DISPATCHED",
  "EN_ROUTE",
  "AT_PICKUP",
  "PATIENT_ONBOARD",
  "AT_HOSPITAL",
  "COMPLETED",
  "CANCELLED",
] as const;
const ambulanceTypes = ["BASIC", "ADVANCED", "ICU", "NEONATAL"] as const;

const idParam = z.object({ id: z.uuid("Invalid emergency id") });

export const createEmergencySchema = z.object({
  body: z.object({
    emergencyType: z.enum(emergencyTypes, {
      error: `emergencyType must be one of ${emergencyTypes.join(", ")}`,
    }),
    patientName: z.string().trim().min(2).max(80).optional(),
    patientPhone: bdPhone.optional(),
    patientAge: z.coerce.number().int().min(0).max(130).optional(),
    isConscious: z.boolean().default(true),
    isBreathing: z.boolean().default(true),
    hasHeavyBleeding: z.boolean().default(false),
    description: z.string().trim().max(1000).optional(),
    pickupAddress: z.string().trim().min(5, "Pickup address is too short").max(255),
    pickupLat: latitude,
    pickupLng: longitude,
    requiredAmbulanceType: z.enum(ambulanceTypes).optional(),
  }),
});

export const listEmergenciesSchema = z.object({
  query: z
    .object({
      ...paginationQuery,
      searchTerm,
      status: z.enum(statuses).optional(),
      priority: z.enum(priorities).optional(),
      emergencyType: z.enum(emergencyTypes).optional(),
      fromDate: z.coerce.date().optional(),
      toDate: z.coerce.date().optional(),
      sortBy: z.enum(["createdAt", "priorityScore", "status", "completedAt"]).default("createdAt"),
    })
    .refine((q) => !q.fromDate || !q.toDate || q.fromDate <= q.toDate, {
      message: "fromDate must be before toDate",
      path: ["fromDate"],
    }),
});

export const emergencyIdSchema = z.object({ params: idParam });

export const trackSchema = z.object({
  params: z.object({
    trackingCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^EMR-\d{8}-[A-Z0-9]{6}$/, "Invalid tracking code format (e.g. EMR-20261118-8F3K2A)"),
  }),
});

export const dispatchSchema = z.object({
  params: idParam,
  body: z
    .object({
      // Optional: omit to let the system auto-select the nearest compatible ambulance.
      ambulanceId: z.uuid("Invalid ambulance id").optional(),
    })
    .default({}),
});

export const updateStatusSchema = z.object({
  params: idParam,
  body: z.object({
    status: z.enum(["EN_ROUTE", "AT_PICKUP", "PATIENT_ONBOARD", "AT_HOSPITAL", "COMPLETED"], {
      error: "status must be EN_ROUTE, AT_PICKUP, PATIENT_ONBOARD, AT_HOSPITAL or COMPLETED",
    }),
    note: z.string().trim().max(500).optional(),
    lat: latitude.optional(),
    lng: longitude.optional(),
  }),
});

export const selectHospitalSchema = z.object({
  params: idParam,
  body: z.object({ hospitalId: z.uuid("Invalid hospital id") }),
});

export const overridePrioritySchema = z.object({
  params: idParam,
  body: z.object({
    priority: z.enum(priorities),
    reason: z.string().trim().min(5, "Please give a reason (min 5 characters)").max(500),
  }),
});

export const cancelSchema = z.object({
  params: idParam,
  body: z.object({
    reason: z
      .string()
      .trim()
      .min(5, "Please give a cancellation reason (min 5 characters)")
      .max(500),
  }),
});

export type CreateEmergencyInput = z.infer<typeof createEmergencySchema>["body"];
export type ListEmergenciesQuery = z.infer<typeof listEmergenciesSchema>["query"];
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>["body"];
export type OverridePriorityInput = z.infer<typeof overridePrioritySchema>["body"];
