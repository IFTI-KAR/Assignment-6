import type { Request, Response } from "express";
import { requireUser } from "../../middlewares/auth";
import { sendResponse } from "../../utils/sendResponse";
import { AdminService } from "./admin.service";
import type { AuditLogsQuery, ListUsersQuery, ReportQuery } from "./admin.validation";

const listUsers = async (req: Request, res: Response) => {
  const { data, meta } = await AdminService.listUsers(req.query as unknown as ListUsersQuery);
  sendResponse(res, { message: "Users retrieved successfully", data, meta });
};

const getUser = async (req: Request, res: Response) => {
  const data = await AdminService.getUser(req.params.id as string);
  sendResponse(res, { message: "User retrieved successfully", data });
};

const changeRole = async (req: Request, res: Response) => {
  const data = await AdminService.changeRole(
    req.params.id as string,
    req.body.role,
    requireUser(req),
    req.ip,
  );
  sendResponse(res, { message: `User role changed to ${data.role}`, data });
};

const changeStatus = async (req: Request, res: Response) => {
  const data = await AdminService.changeStatus(
    req.params.id as string,
    req.body.status,
    requireUser(req),
    req.ip,
  );
  sendResponse(res, { message: `User is now ${data.status}`, data });
};

const deleteUser = async (req: Request, res: Response) => {
  await AdminService.deleteUser(req.params.id as string, requireUser(req), req.ip);
  sendResponse(res, { message: "User deleted (soft delete)" });
};

const dashboardStats = async (_req: Request, res: Response) => {
  const data = await AdminService.dashboardStats();
  sendResponse(res, { message: "Dashboard statistics retrieved", data });
};

const emergencyReport = async (req: Request, res: Response) => {
  const data = await AdminService.emergencyReport(req.query as unknown as ReportQuery);
  sendResponse(res, { message: "Emergency report generated", data });
};

const auditLogs = async (req: Request, res: Response) => {
  const { data, meta } = await AdminService.auditLogs(req.query as unknown as AuditLogsQuery);
  sendResponse(res, { message: "Audit logs retrieved", data, meta });
};

export const AdminController = {
  listUsers,
  getUser,
  changeRole,
  changeStatus,
  deleteUser,
  dashboardStats,
  emergencyReport,
  auditLogs,
};
