import type { Request, Response } from "express";
import { requireUser } from "../../middlewares/auth";
import { sendResponse } from "../../utils/sendResponse";
import { DispatchService } from "./dispatch.service";
import { EmergencyService } from "./emergency.service";
import type { ListEmergenciesQuery } from "./emergency.validation";

const meta = (req: Request) => ({ ip: req.ip });
const id = (req: Request) => req.params.id as string;

const create = async (req: Request, res: Response) => {
  const data = await EmergencyService.create(requireUser(req).id, req.body, meta(req));
  sendResponse(res, {
    statusCode: 201,
    message: `Emergency received (${data.priority}). Help is being arranged — tracking code ${data.trackingCode}`,
    data,
  });
};

const list = async (req: Request, res: Response) => {
  const result = await EmergencyService.list(
    requireUser(req),
    req.query as unknown as ListEmergenciesQuery,
  );
  sendResponse(res, { message: "Emergencies retrieved successfully", ...result });
};

const queue = async (_req: Request, res: Response) => {
  const data = await EmergencyService.queue();
  sendResponse(res, { message: `${data.length} emergency request(s) waiting for dispatch`, data });
};

const myActive = async (req: Request, res: Response) => {
  const data = await EmergencyService.myActive(requireUser(req));
  sendResponse(res, {
    message: data ? "Active emergency retrieved" : "You have no active emergency",
    data,
  });
};

const getById = async (req: Request, res: Response) => {
  const data = await EmergencyService.getById(id(req), requireUser(req));
  sendResponse(res, { message: "Emergency retrieved successfully", data });
};

const timeline = async (req: Request, res: Response) => {
  const data = await EmergencyService.timeline(id(req), requireUser(req));
  sendResponse(res, { message: "Incident timeline retrieved successfully", data });
};

const track = async (req: Request, res: Response) => {
  const data = await EmergencyService.track(req.params.trackingCode as string);
  sendResponse(res, { message: "Tracking information retrieved", data });
};

const dispatch = async (req: Request, res: Response) => {
  const data = await DispatchService.dispatch(
    id(req),
    req.body?.ambulanceId,
    requireUser(req),
    meta(req),
  );
  sendResponse(res, { message: `Ambulance ${data.dispatch.registrationNo} dispatched`, data });
};

const dispatchNext = async (req: Request, res: Response) => {
  const data = await DispatchService.dispatchNext(requireUser(req), meta(req));
  sendResponse(res, {
    message: `Highest-priority request ${data.emergency.trackingCode} dispatched to ${data.dispatch.registrationNo}`,
    data,
  });
};

const updateStatus = async (req: Request, res: Response) => {
  const data = await DispatchService.updateStatus(id(req), req.body, requireUser(req), meta(req));
  sendResponse(res, { message: `Trip status updated to ${data.status}`, data });
};

const selectHospital = async (req: Request, res: Response) => {
  const data = await DispatchService.selectHospital(
    id(req),
    req.body.hospitalId,
    requireUser(req),
    meta(req),
  );
  sendResponse(res, { message: `Destination hospital set to ${data.hospital?.name}`, data });
};

const overridePriority = async (req: Request, res: Response) => {
  const data = await EmergencyService.overridePriority(
    id(req),
    req.body,
    requireUser(req),
    meta(req),
  );
  sendResponse(res, { message: `Priority changed to ${data.priority}`, data });
};

const cancel = async (req: Request, res: Response) => {
  const data = await EmergencyService.cancel(id(req), req.body.reason, requireUser(req), meta(req));
  sendResponse(res, { message: "Emergency cancelled", data });
};

const softDelete = async (req: Request, res: Response) => {
  await EmergencyService.softDelete(id(req), requireUser(req), meta(req));
  sendResponse(res, { message: "Emergency archived (soft deleted)" });
};

export const EmergencyController = {
  create,
  list,
  queue,
  myActive,
  getById,
  timeline,
  track,
  dispatch,
  dispatchNext,
  updateStatus,
  selectHospital,
  overridePriority,
  cancel,
  softDelete,
};
