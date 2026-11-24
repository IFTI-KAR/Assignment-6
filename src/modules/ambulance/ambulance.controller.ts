import type { Request, Response } from "express";
import { requireUser } from "../../middlewares/auth";
import { auditContext } from "../../utils/audit";
import { sendResponse } from "../../utils/sendResponse";
import { AmbulanceService } from "./ambulance.service";
import type { AvailableAmbulancesQuery, ListAmbulancesQuery } from "./ambulance.validation";

const create = async (req: Request, res: Response) => {
  const data = await AmbulanceService.create(req.body, auditContext(req));
  sendResponse(res, { statusCode: 201, message: "Ambulance registered successfully", data });
};

const list = async (req: Request, res: Response) => {
  const { data, meta } = await AmbulanceService.list(req.query as unknown as ListAmbulancesQuery);
  sendResponse(res, { message: "Ambulances retrieved successfully", data, meta });
};

const available = async (req: Request, res: Response) => {
  const data = await AmbulanceService.available(req.query as unknown as AvailableAmbulancesQuery);
  sendResponse(res, { message: `Found ${data.length} available ambulance(s)`, data });
};

const getById = async (req: Request, res: Response) => {
  const data = await AmbulanceService.getById(req.params.id as string, requireUser(req));
  sendResponse(res, { message: "Ambulance retrieved successfully", data });
};

const update = async (req: Request, res: Response) => {
  const data = await AmbulanceService.update(req.params.id as string, req.body, auditContext(req));
  sendResponse(res, { message: "Ambulance updated successfully", data });
};

const assignDriver = async (req: Request, res: Response) => {
  const data = await AmbulanceService.assignDriver(
    req.params.id as string,
    req.body.driverProfileId,
    auditContext(req),
  );
  sendResponse(res, {
    message: req.body.driverProfileId
      ? "Driver assigned to ambulance"
      : "Driver unassigned from ambulance",
    data,
  });
};

const updateStatus = async (req: Request, res: Response) => {
  const data = await AmbulanceService.updateStatus(
    req.params.id as string,
    req.body.status,
    auditContext(req),
  );
  sendResponse(res, { message: `Ambulance marked ${data.status}`, data });
};

const softDelete = async (req: Request, res: Response) => {
  await AmbulanceService.softDelete(req.params.id as string, auditContext(req));
  sendResponse(res, { message: "Ambulance deleted successfully" });
};

export const AmbulanceController = {
  create,
  list,
  available,
  getById,
  update,
  assignDriver,
  updateStatus,
  softDelete,
};
