import type {
  AmbulanceType,
  EmergencyStatus,
  EmergencyType,
  Priority,
  Prisma,
} from "../../generated/prisma/client";

/** Statuses in which an emergency is still "live" (occupies a patient / driver / ambulance). */
export const ACTIVE_EMERGENCY_STATUSES: EmergencyStatus[] = [
  "PENDING",
  "DISPATCHED",
  "EN_ROUTE",
  "AT_PICKUP",
  "PATIENT_ONBOARD",
  "AT_HOSPITAL",
];

/** Statuses in which an ambulance is physically committed to the trip. */
export const ON_TRIP_STATUSES: EmergencyStatus[] = [
  "DISPATCHED",
  "EN_ROUTE",
  "AT_PICKUP",
  "PATIENT_ONBOARD",
  "AT_HOSPITAL",
];

/**
 * Driver-controlled state machine.
 *   DISPATCHED → EN_ROUTE → AT_PICKUP → PATIENT_ONBOARD → AT_HOSPITAL → COMPLETED
 * (PENDING → DISPATCHED happens via the dispatch endpoint, CANCELLED via the cancel endpoint.)
 */
export const DRIVER_TRANSITIONS: Partial<Record<EmergencyStatus, EmergencyStatus>> = {
  DISPATCHED: "EN_ROUTE",
  EN_ROUTE: "AT_PICKUP",
  AT_PICKUP: "PATIENT_ONBOARD",
  PATIENT_ONBOARD: "AT_HOSPITAL",
  AT_HOSPITAL: "COMPLETED",
};

/** Timestamp column written when entering each status. */
export const STATUS_TIMESTAMP_FIELD: Partial<
  Record<EmergencyStatus, keyof Prisma.EmergencyRequestUpdateInput>
> = {
  DISPATCHED: "dispatchedAt",
  EN_ROUTE: "enRouteAt",
  AT_PICKUP: "atPickupAt",
  PATIENT_ONBOARD: "pickedUpAt",
  AT_HOSPITAL: "atHospitalAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
};

/** Patients may cancel only before the ambulance reaches them. */
export const PATIENT_CANCELLABLE: EmergencyStatus[] = ["PENDING", "DISPATCHED", "EN_ROUTE"];
/** Admins can cancel at any point before the patient is on board. */
export const ADMIN_CANCELLABLE: EmergencyStatus[] = [
  "PENDING",
  "DISPATCHED",
  "EN_ROUTE",
  "AT_PICKUP",
];
/** Hospital may be (re)selected while the trip is still heading there. */
export const HOSPITAL_SELECTABLE: EmergencyStatus[] = [
  "DISPATCHED",
  "EN_ROUTE",
  "AT_PICKUP",
  "PATIENT_ONBOARD",
];

// ------------------------------------------------------------------
//  Triage / priority scoring
// ------------------------------------------------------------------

const BASE_SCORE: Record<EmergencyType, number> = {
  CARDIAC: 75,
  STROKE: 75,
  RESPIRATORY: 65,
  TRAUMA: 60,
  ACCIDENT: 55,
  BURN: 55,
  POISONING: 50,
  MATERNITY: 45,
  OTHER: 25,
};

type TriageInput = {
  emergencyType: EmergencyType;
  isConscious: boolean;
  isBreathing: boolean;
  hasHeavyBleeding: boolean;
  patientAge?: number | null;
};

export const scoreToPriority = (score: number): Priority => {
  if (score >= 85) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
};

/** Minimum score for a manually overridden priority (keeps queue ordering consistent). */
export const PRIORITY_FLOOR: Record<Priority, number> = {
  CRITICAL: 90,
  HIGH: 70,
  MEDIUM: 50,
  LOW: 20,
};

/** Rule-based triage: emergency type + vital signs + age → 0-100 score → priority level. */
export const calculatePriority = (t: TriageInput) => {
  let score = BASE_SCORE[t.emergencyType];
  if (!t.isBreathing) score += 30;
  if (!t.isConscious) score += 20;
  if (t.hasHeavyBleeding) score += 15;
  if (t.patientAge != null && (t.patientAge >= 65 || t.patientAge <= 5)) score += 5;
  score = Math.min(100, score);
  return { priorityScore: score, priority: scoreToPriority(score) };
};

/** Picks an ambulance class when the caller didn't request one. */
export const recommendAmbulanceType = (
  priority: Priority,
  patientAge?: number | null,
): AmbulanceType | null => {
  if (patientAge != null && patientAge < 1) return "NEONATAL";
  if (priority === "CRITICAL") return "ADVANCED";
  return null; // any ambulance is acceptable
};

/** Which ambulance types can serve a requested type (higher capability can serve lower). */
export const COMPATIBLE_TYPES: Record<AmbulanceType, AmbulanceType[]> = {
  BASIC: ["BASIC", "ADVANCED", "ICU"],
  ADVANCED: ["ADVANCED", "ICU"],
  ICU: ["ICU"],
  NEONATAL: ["NEONATAL"],
};

export const emergencySortableFields = [
  "createdAt",
  "priorityScore",
  "status",
  "completedAt",
] as const;
