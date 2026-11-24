import { Router } from "express";
import { auth } from "../../middlewares/auth";
import { validateRequest } from "../../middlewares/validateRequest";
import { AdminController } from "./admin.controller";
import {
  auditLogsSchema,
  changeRoleSchema,
  changeStatusSchema,
  listUsersSchema,
  reportSchema,
  userIdSchema,
} from "./admin.validation";

const router = Router();

// Every admin route requires the ADMIN role.
router.use(auth("ADMIN"));

router.get("/users", validateRequest(listUsersSchema), AdminController.listUsers);
router.get("/users/:id", validateRequest(userIdSchema), AdminController.getUser);
router.patch("/users/:id/role", validateRequest(changeRoleSchema), AdminController.changeRole);
router.patch(
  "/users/:id/status",
  validateRequest(changeStatusSchema),
  AdminController.changeStatus,
);
router.delete("/users/:id", validateRequest(userIdSchema), AdminController.deleteUser);

router.get("/dashboard-stats", AdminController.dashboardStats);
router.get("/reports/emergencies", validateRequest(reportSchema), AdminController.emergencyReport);
router.get("/audit-logs", validateRequest(auditLogsSchema), AdminController.auditLogs);

export const AdminRoutes = router;
