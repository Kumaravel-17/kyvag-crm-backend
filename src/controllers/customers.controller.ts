import type { RequestHandler } from "express";
import { PAID, listLeads } from "../crm/leads.js";
import * as s from "../crm/schemas.js";
import { parse } from "../http.js";

/** Customers are the leads in the paid stage */
export const list: RequestHandler = async (req, res) => {
  const { q, page, pageSize } = parse(s.leadQuery, req.query);
  const { leads, ...rest } = await listLeads({ q, page, pageSize, stage: PAID });
  res.json({ customers: leads, ...rest });
};
