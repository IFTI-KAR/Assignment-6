import type { Request, Response } from "express";
import { auditContext } from "../../utils/audit";
import { sendResponse } from "../../utils/sendResponse";
import { HospitalService } from "./hospital.service";
import type { ListHospitalsQuery, NearbyHospitalsQuery } from "./hospital.validation";

const create = async (req: Request, res: Response) => {
  const data = await HospitalService.create(req.body, auditContext(req));
  sendResponse(res, { statusCode: 201, message: "Hospital created successfully", data });
};

const list = async (req: Request, res: Response) => {
  const { data, meta } = await HospitalService.list(req.query as unknown as ListHospitalsQuery);
  sendResponse(res, { message: "Hospitals retrieved successfully", data, meta });
};

const nearby = async (req: Request, res: Response) => {
  const data = await HospitalService.nearby(req.query as unknown as NearbyHospitalsQuery);
  sendResponse(res, { message: `Found ${data.length} nearby hospital(s) with free beds`, data });
};

const getById = async (req: Request, res: Response) => {
  const data = await HospitalService.getById(req.params.id as string);
  sendResponse(res, { message: "Hospital retrieved successfully", data });
};

const update = async (req: Request, res: Response) => {
  const data = await HospitalService.update(req.params.id as string, req.body, auditContext(req));
  sendResponse(res, { message: "Hospital updated successfully", data });
};

const updateBeds = async (req: Request, res: Response) => {
  const data = await HospitalService.updateBeds(req.params.id as string, req.body, auditContext(req));
  sendResponse(res, { message: "Bed availability updated", data });
};

const softDelete = async (req: Request, res: Response) => {
  await HospitalService.softDelete(req.params.id as string, auditContext(req));
  sendResponse(res, { message: "Hospital deleted successfully" });
};

export const HospitalController = { create, list, nearby, getById, update, updateBeds, softDelete };
