import { Router } from "express";
import { auth } from "../../middlewares/auth";
import { validateRequest } from "../../middlewares/validateRequest";
import { DriverController } from "./driver.controller";
import {
  driverIdSchema,
  listDriversSchema,
  updateDutySchema,
  updateLocationSchema,
  verifyDriverSchema,
} from "./driver.validation";

const router = Router();

// Driver self-service (must be declared before "/:id")
router.get("/me/summary", auth("DRIVER"), DriverController.mySummary);
router.patch(
  "/me/duty",
  auth("DRIVER"),
  validateRequest(updateDutySchema),
  DriverController.updateDuty,
);
router.patch(
  "/me/location",
  auth("DRIVER"),
  validateRequest(updateLocationSchema),
  DriverController.updateLocation,
);

// Admin management
router.get("/", auth("ADMIN"), validateRequest(listDriversSchema), DriverController.list);
router.get("/:id", auth("ADMIN"), validateRequest(driverIdSchema), DriverController.getById);
router.patch(
  "/:id/verify",
  auth("ADMIN"),
  validateRequest(verifyDriverSchema),
  DriverController.verify,
);

export const DriverRoutes = router;
