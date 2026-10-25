import type { RequestHandler } from "express";
import { dashboard } from "../crm/dashboard.js";

export const getDashboard: RequestHandler = async (_req, res) => {
  res.json(await dashboard());
};
