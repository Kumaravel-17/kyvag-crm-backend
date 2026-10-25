import type { RequestHandler } from "express";
import { authOf } from "../auth/middleware.js";
import { LOGGABLE_KINDS, addActivity, deleteActivity, getActivity, listActivities } from "../crm/activities.js";
import { getLead, updateLead } from "../crm/leads.js";
import * as s from "../crm/schemas.js";
import { HttpError, parse } from "../http.js";

function leadIdOr404(id: string) {
  if (!getLead(id)) throw new HttpError(404, "That lead wasn't found. It may have been removed.");
  return id;
}

export const list: RequestHandler = (req, res) => {
  res.json({ activities: listActivities(leadIdOr404(String(req.params.id))) });
};

export const create: RequestHandler = (req, res) => {
  const { user } = authOf(req);
  const leadId = leadIdOr404(String(req.params.id));
  const { kind, text } = parse(s.activityBody, req.body);
  const activity = addActivity({ leadId, kind, text, authorId: user.id });
  updateLead(leadId, { last_activity: text.length > 80 ? `${text.slice(0, 79)}…` : text });
  res.status(201).json({ activity });
};

/** People can delete what they logged; admins can delete anything logged by hand */
export const remove: RequestHandler = (req, res) => {
  const { user } = authOf(req);
  const activity = getActivity(String(req.params.activityId));
  if (!activity || activity.lead_id !== req.params.id) throw new HttpError(404, "That activity wasn't found.");
  // Stage moves, captures and auto-replies are the lead's history, so only hand-logged entries can go
  if (!activity.author_id || !(LOGGABLE_KINDS as readonly string[]).includes(activity.kind)) {
    throw new HttpError(403, "Entries logged by Kyvag can't be deleted.");
  }
  if (activity.author_id !== user.id && user.role !== "admin") throw new HttpError(403, "You can only delete activity you logged.");
  deleteActivity(activity.id);
  res.json({ ok: true });
};
