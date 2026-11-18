import type { Request, Response } from "express";
import { sendResponse } from "../../utils/sendResponse";
import { UserService } from "./user.service";

const getMe = async (req: Request, res: Response) => {
  const data = await UserService.getMe(req.user!.id);
  sendResponse(res, { message: "Profile retrieved successfully", data });
};

const updateMe = async (req: Request, res: Response) => {
  const data = await UserService.updateMe(req.user!.id, req.body, req.ip);
  sendResponse(res, { message: "Profile updated successfully", data });
};

const updateAvatar = async (req: Request, res: Response) => {
  const data = await UserService.updateAvatar(req.user!.id, req.file);
  sendResponse(res, { message: "Avatar uploaded successfully", data });
};

const deleteMe = async (req: Request, res: Response) => {
  await UserService.deleteMe(req.user!.id, req.user!.role, req.ip);
  sendResponse(res, { message: "Your account has been deleted" });
};

export const UserController = { getMe, updateMe, updateAvatar, deleteMe };
