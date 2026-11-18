import { Router } from "express";
import { auth } from "../../middlewares/auth";
import { emergencyLimiter } from "../../middlewares/rateLimiter";
import { validateRequest } from "../../middlewares/validateRequest";
import { EmergencyController } from "./emergency.controller";
import {
  cancelSchema,
  createEmergencySchema,
  dispatchSchema,
  emergencyIdSchema,
  listEmergenciesSchema,
  overridePrioritySchema,
  selectHospitalSchema,
  trackSchema,
  updateStatusSchema,
} from "./emergency.validation";

const router = Router();

// --- Static paths first (so they are not captured by "/:id") ---
router.get("/track/:trackingCode", validateRequest(trackSchema), EmergencyController.track); // public
router.get("/queue", auth("ADMIN"), EmergencyController.queue);
router.get("/my-active", auth("PATIENT", "DRIVER"), EmergencyController.myActive);
router.post("/dispatch-next", auth("ADMIN"), EmergencyController.dispatchNext);

// --- Collection ---
router.post(
  "/",
  emergencyLimiter,
  auth("PATIENT"),
  validateRequest(createEmergencySchema),
  EmergencyController.create,
);
router.get("/", auth(), validateRequest(listEmergenciesSchema), EmergencyController.list);

// --- Single resource ---
router.get("/:id", auth(), validateRequest(emergencyIdSchema), EmergencyController.getById);
router.get("/:id/timeline", auth(), validateRequest(emergencyIdSchema), EmergencyController.timeline);
router.delete("/:id", auth("ADMIN"), validateRequest(emergencyIdSchema), EmergencyController.softDelete);

// --- Workflow / business operations ---
router.post("/:id/dispatch", auth("ADMIN"), validateRequest(dispatchSchema), EmergencyController.dispatch);
router.patch("/:id/status", auth("DRIVER"), validateRequest(updateStatusSchema), EmergencyController.updateStatus);
router.patch(
  "/:id/hospital",
  auth("DRIVER", "ADMIN"),
  validateRequest(selectHospitalSchema),
  EmergencyController.selectHospital,
);
router.patch(
  "/:id/priority",
  auth("ADMIN"),
  validateRequest(overridePrioritySchema),
  EmergencyController.overridePriority,
);
router.post("/:id/cancel", auth("PATIENT", "ADMIN"), validateRequest(cancelSchema), EmergencyController.cancel);

export const EmergencyRoutes = router;
