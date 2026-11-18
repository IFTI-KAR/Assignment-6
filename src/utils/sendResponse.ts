import type { Response } from "express";

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type SuccessPayload<T> = {
  statusCode?: number;
  message: string;
  data?: T;
  meta?: PaginationMeta;
};

/** Every successful response follows: { success: true, message, data, meta? } */
export const sendResponse = <T>(res: Response, payload: SuccessPayload<T>) => {
  const { statusCode = 200, message, data = null, meta } = payload;
  res.status(statusCode).json({
    success: true,
    message,
    ...(meta ? { meta } : {}),
    data: data ?? {},
  });
};
