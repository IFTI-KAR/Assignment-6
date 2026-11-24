import type { Request, Response } from "express";
import { requireUser } from "../../middlewares/auth";
import { auditContext } from "../../utils/audit";
import { sendResponse } from "../../utils/sendResponse";
import { DriverService } from "./driver.service";
import type { ListDriversQuery } from "./driver.validation";

const list = async (req: Request, res: Response) => {
  const { data, meta } = await DriverService.list(req.query as unknown as ListDriversQuery);
  sendResponse(res, { message: "Drivers retrieved successfully", data, meta });
};

const getById = async (req: Request, res: Response) => {
  const data = await DriverService.getById(req.params.id as string);
  sendResponse(res, { message: "Driver retrieved successfully", data });
};

const verify = async (req: Request, res: Response) => {
  const data = await DriverService.verify(
    req.params.id as string,
    req.body.isVerified,
    auditContext(req),
  );
  sendResponse(res, {
    message: data.isVerified ? "Driver verified" : "Driver verification revoked",
    data,
  });
};

const updateDuty = async (req: Request, res: Response) => {
  const data = await DriverService.updateDuty(requireUser(req).id, req.body, req.ip);
  sendResponse(res, {
    message: data.isOnDuty ? "You are now ON duty" : "You are now OFF duty",
    data,
  });
};

const updateLocation = async (req: Request, res: Response) => {
  const data = await DriverService.updateLocation(requireUser(req).id, req.body);
  sendResponse(res, { message: "Location updated", data });
};

const mySummary = async (req: Request, res: Response) => {
  const data = await DriverService.mySummary(requireUser(req).id);
  sendResponse(res, { message: "Driver summary retrieved successfully", data });
};

export const DriverController = { list, getById, verify, updateDuty, updateLocation, mySummary };
