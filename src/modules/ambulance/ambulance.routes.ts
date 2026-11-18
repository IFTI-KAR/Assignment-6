import { Router } from "express";
import { auth } from "../../middlewares/auth";
import { validateRequest } from "../../middlewares/validateRequest";
import { AmbulanceController } from "./ambulance.controller";
import {
  ambulanceIdSchema,
  assignDriverSchema,
  availableAmbulancesSchema,
  createAmbulanceSchema,
  listAmbulancesSchema,
  updateAmbulanceSchema,
  updateAmbulanceStatusSchema,
} from "./ambulance.validation";

const router = Router();

router.post("/", auth("ADMIN"), validateRequest(createAmbulanceSchema), AmbulanceController.create);
router.get("/", auth("ADMIN"), validateRequest(listAmbulancesSchema), AmbulanceController.list);
router.get(
  "/available",
  auth("ADMIN"),
  validateRequest(availableAmbulancesSchema),
  AmbulanceController.available,
);
router.get("/:id", auth("ADMIN", "DRIVER"), validateRequest(ambulanceIdSchema), AmbulanceController.getById);
router.patch("/:id", auth("ADMIN"), validateRequest(updateAmbulanceSchema), AmbulanceController.update);
router.patch(
  "/:id/driver",
  auth("ADMIN"),
  validateRequest(assignDriverSchema),
  AmbulanceController.assignDriver,
);
router.patch(
  "/:id/status",
  auth("ADMIN"),
  validateRequest(updateAmbulanceStatusSchema),
  AmbulanceController.updateStatus,
);
router.delete("/:id", auth("ADMIN"), validateRequest(ambulanceIdSchema), AmbulanceController.softDelete);

export const AmbulanceRoutes = router;
