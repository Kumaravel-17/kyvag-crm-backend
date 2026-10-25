import type { RequestHandler } from "express";
import { dashboard } from "../crm/dashboard.js";

export const getDashboard: RequestHandler = (_req, res) => {
  res.json(dashboard());
};
