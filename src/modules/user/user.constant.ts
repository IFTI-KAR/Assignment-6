import type { Prisma } from "../../generated/prisma/client";

/** Never leak password hashes: every user response goes through this select. */
export const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatar: true,
  role: true,
  status: true,
  authProvider: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export const userWithDriverSelect = {
  ...safeUserSelect,
  driverProfile: {
    select: {
      id: true,
      licenseNumber: true,
      licenseExpiry: true,
      experienceYears: true,
      isVerified: true,
      isOnDuty: true,
      currentLat: true,
      currentLng: true,
      lastLocationAt: true,
      totalTrips: true,
      ambulance: { select: { id: true, registrationNo: true, type: true, status: true } },
    },
  },
} satisfies Prisma.UserSelect;

export const userSortableFields = ["createdAt", "name", "email", "lastLoginAt"] as const;
