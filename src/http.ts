import type { ErrorRequestHandler } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Validates a request body, turning schema failures into a 400 the client can show per field */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    throw new HttpError(400, fields[0]?.message ?? "Invalid request.", fields);
  }
  return result.data;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }
  // Malformed JSON bodies come from express.json() with a 4xx status already set
  if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: "Invalid request body." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Try again." });
};
