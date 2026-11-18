import type { ErrorRequestHandler } from "express";
import jwt from "jsonwebtoken";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { config } from "../config";
import { AppError, type ErrorDetail } from "../errors/AppError";
import { Prisma } from "../generated/prisma/client";

type Normalized = { statusCode: number; message: string; errors: ErrorDetail[] };

const handlePrismaKnownError = (err: Prisma.PrismaClientKnownRequestError): Normalized => {
  switch (err.code) {
    case "P2002": {
      const target = (err.meta?.target as string[] | string | undefined) ?? "field";
      const fields = Array.isArray(target) ? target.join(", ") : String(target);
      return {
        statusCode: 409,
        message: `Duplicate value: a record with this ${fields} already exists`,
        errors: [{ path: fields, message: "Must be unique" }],
      };
    }
    case "P2025":
      return { statusCode: 404, message: "Requested record was not found", errors: [] };
    case "P2003":
      return {
        statusCode: 400,
        message: "Invalid reference: related record does not exist",
        errors: [{ path: String(err.meta?.field_name ?? ""), message: "Foreign key constraint failed" }],
      };
    case "P2034":
      return {
        statusCode: 409,
        message: "Concurrent update conflict, please retry",
        errors: [],
      };
    default:
      return { statusCode: 400, message: `Database error (${err.code})`, errors: [] };
  }
};

const normalizeError = (err: unknown): Normalized => {
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, message: err.message, errors: err.errors };
  }
  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      message: "Validation failed",
      errors: err.issues.map((issue) => ({
        // Strip the leading "body"/"query"/"params" segment for readability.
        path: issue.path.slice(issue.path.length > 1 ? 1 : 0).join("."),
        message: issue.message,
      })),
    };
  }
  if (err instanceof jwt.TokenExpiredError) {
    return { statusCode: 401, message: "Token has expired", errors: [] };
  }
  if (err instanceof jwt.JsonWebTokenError) {
    return { statusCode: 401, message: "Invalid token", errors: [] };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) return handlePrismaKnownError(err);
  if (err instanceof Prisma.PrismaClientValidationError) {
    return { statusCode: 400, message: "Invalid data sent to the database", errors: [] };
  }
  if (err instanceof MulterError) {
    return {
      statusCode: 400,
      message: err.code === "LIMIT_FILE_SIZE" ? "File is too large" : err.message,
      errors: [{ path: err.field ?? "file", message: err.message }],
    };
  }
  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && "body" in err) {
    return { statusCode: 400, message: "Malformed JSON in request body", errors: [] };
  }
  return { statusCode: 500, message: "Something went wrong", errors: [] };
};

export const globalErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { statusCode, message, errors } = normalizeError(err);

  if (statusCode >= 500) console.error("💥", err);

  res.status(statusCode).json({
    success: false,
    message,
    errors,
    ...(!config.isProduction && statusCode >= 500 && err instanceof Error ? { stack: err.stack } : {}),
  });
};
