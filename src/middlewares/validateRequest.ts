import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

/**
 * Validates `{ body, query, params }` against a Zod schema and replaces them with
 * the parsed (coerced, defaulted, stripped) values. ZodErrors are formatted by the
 * global error handler.
 */
export const validateRequest =
  (schema: ZodType) => async (req: Request, _res: Response, next: NextFunction) => {
    const parsed = (await schema.parseAsync({
      body: req.body ?? {},
      query: req.query ?? {},
      params: req.params ?? {},
    })) as { body?: unknown; query?: unknown; params?: unknown };

    if (parsed.body !== undefined) req.body = parsed.body;
    // Express 5 exposes req.query via a getter, so it has to be redefined.
    if (parsed.query !== undefined) {
      Object.defineProperty(req, "query", {
        value: parsed.query,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    if (parsed.params !== undefined) req.params = parsed.params as Request["params"];
    next();
  };
