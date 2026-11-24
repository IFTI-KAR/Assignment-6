import type { Request, Response } from "express";
import { requireUser } from "../../middlewares/auth";
import { sendResponse } from "../../utils/sendResponse";
import { UserService } from "./user.service";

const getMe = async (req: Request, res: Response) => {
  const data = await UserService.getMe(requireUser(req).id);
  sendResponse(res, { message: "Profile retrieved successfully", data });
};

const updateMe = async (req: Request, res: Response) => {
  const data = await UserService.updateMe(requireUser(req).id, req.body, req.ip);
  sendResponse(res, { message: "Profile updated successfully", data });
};

const updateAvatar = async (req: Request, res: Response) => {
  const data = await UserService.updateAvatar(requireUser(req).id, req.file);
  sendResponse(res, { message: "Avatar uploaded successfully", data });
};

const deleteMe = async (req: Request, res: Response) => {
  const user = requireUser(req);
  await UserService.deleteMe(user.id, user.role, req.ip);
  sendResponse(res, { message: "Your account has been deleted" });
};

export const UserController = { getMe, updateMe, updateAvatar, deleteMe };
