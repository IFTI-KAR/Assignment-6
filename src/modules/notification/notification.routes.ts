import { Router } from "express";
import { auth } from "../../middlewares/auth";
import { validateRequest } from "../../middlewares/validateRequest";
import { NotificationController } from "./notification.controller";
import { listNotificationsSchema, notificationIdSchema } from "./notification.validation";

const router = Router();

router.get("/", auth(), validateRequest(listNotificationsSchema), NotificationController.list);
router.patch("/read-all", auth(), NotificationController.markAllRead);
router.patch("/:id/read", auth(), validateRequest(notificationIdSchema), NotificationController.markRead);

export const NotificationRoutes = router;
