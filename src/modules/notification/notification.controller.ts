import type { Request, Response } from "express";
import { requireUser } from "../../middlewares/auth";
import { sendResponse } from "../../utils/sendResponse";
import { NotificationService } from "./notification.service";
import type { ListNotificationsQuery } from "./notification.validation";

const list = async (req: Request, res: Response) => {
  const { data, meta, unread } = await NotificationService.list(
    requireUser(req).id,
    req.query as unknown as ListNotificationsQuery,
  );
  sendResponse(res, {
    message: "Notifications retrieved",
    data: { unread, notifications: data },
    meta,
  });
};

const markRead = async (req: Request, res: Response) => {
  const data = await NotificationService.markRead(requireUser(req).id, req.params.id as string);
  sendResponse(res, { message: "Notification marked as read", data });
};

const markAllRead = async (req: Request, res: Response) => {
  const data = await NotificationService.markAllRead(requireUser(req).id);
  sendResponse(res, { message: `${data.updated} notification(s) marked as read`, data });
};

export const NotificationController = { list, markRead, markAllRead };
