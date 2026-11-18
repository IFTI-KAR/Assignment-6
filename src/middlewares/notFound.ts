import type { RequestHandler } from "express";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found",
    errors: [{ path: req.originalUrl, message: `Cannot ${req.method} ${req.originalUrl}` }],
  });
};
