import { z } from "zod";
import { booleanQuery, paginationQuery, searchTerm } from "../../utils/pagination";
import { latitude, longitude } from "../hospital/hospital.validation";

const idParam = z.object({ id: z.uuid("Invalid driver profile id") });

export const listDriversSchema = z.object({
  query: z.object({
    ...paginationQuery,
    searchTerm,
    isVerified: booleanQuery.optional(),
    isOnDuty: booleanQuery.optional(),
    hasAmbulance: booleanQuery.optional(),
    sortBy: z
      .enum(["createdAt", "totalTrips", "experienceYears", "licenseExpiry"])
      .default("createdAt"),
  }),
});

export const driverIdSchema = z.object({ params: idParam });

export const verifyDriverSchema = z.object({
  params: idParam,
  body: z.object({ isVerified: z.boolean({ error: "isVerified must be true or false" }) }),
});

export const updateDutySchema = z.object({
  body: z.object({
    isOnDuty: z.boolean({ error: "isOnDuty must be true or false" }),
    lat: latitude.optional(),
    lng: longitude.optional(),
  }),
});

export const updateLocationSchema = z.object({
  body: z.object({ lat: latitude, lng: longitude }),
});

export type ListDriversQuery = z.infer<typeof listDriversSchema>["query"];
export type UpdateDutyInput = z.infer<typeof updateDutySchema>["body"];
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>["body"];
