import { Router } from "express";
import { auth } from "../../middlewares/auth";
import { validateRequest } from "../../middlewares/validateRequest";
import { HospitalController } from "./hospital.controller";
import {
  createHospitalSchema,
  hospitalIdSchema,
  listHospitalsSchema,
  nearbyHospitalsSchema,
  updateBedsSchema,
  updateHospitalSchema,
} from "./hospital.validation";

const router = Router();

// Public hospital directory
router.get("/", validateRequest(listHospitalsSchema), HospitalController.list);
router.get("/nearby", auth(), validateRequest(nearbyHospitalsSchema), HospitalController.nearby);
router.get("/:id", validateRequest(hospitalIdSchema), HospitalController.getById);

// Admin management
router.post("/", auth("ADMIN"), validateRequest(createHospitalSchema), HospitalController.create);
router.patch(
  "/:id",
  auth("ADMIN"),
  validateRequest(updateHospitalSchema),
  HospitalController.update,
);
router.patch(
  "/:id/beds",
  auth("ADMIN"),
  validateRequest(updateBedsSchema),
  HospitalController.updateBeds,
);
router.delete(
  "/:id",
  auth("ADMIN"),
  validateRequest(hospitalIdSchema),
  HospitalController.softDelete,
);

export const HospitalRoutes = router;
