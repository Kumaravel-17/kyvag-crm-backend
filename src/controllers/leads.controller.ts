import type { RequestHandler } from "express";
import { authOf } from "../auth/middleware.js";
import { getUserById } from "../auth/users.js";
import { addActivity } from "../crm/activities.js";
import {
  CHANNEL_LABEL, CHURNED, PAID, createLead, getLead, listCategories, listLeads, publicLead, updateLead, type LeadUpdate,
} from "../crm/leads.js";
import { isStage, listStages } from "../crm/pipeline.js";
import * as s from "../crm/schemas.js";
import { HttpError, parse } from "../http.js";

const stageLabel = (id: string) => (id === CHURNED ? "Churned" : listStages().find((st) => st.id === id)?.label ?? id);

function leadOr404(id: string) {
  const lead = getLead(id);
  if (!lead) throw new HttpError(404, "That lead wasn't found. It may have been removed.");
  return lead;
}

export const list: RequestHandler = (req, res) => {
  const { stage, ...filters } = parse(s.leadQuery, req.query);
  res.json(listLeads({ ...filters, stage: stage === "all" ? undefined : stage }));
};

export const get: RequestHandler = (req, res) => {
  res.json({ lead: publicLead(leadOr404(String(req.params.id))) });
};

export const create: RequestHandler = (req, res) => {
  const { user } = authOf(req);
  const body = parse(s.createLeadBody, req.body);
  const first = listStages()[0];
  const lead = createLead({ ...body, stage: first.id, ownerId: user.id, lastActivity: `Added by ${user.name}` });
  addActivity({ leadId: lead.id, kind: "capture", text: `Lead added by hand · ${CHANNEL_LABEL[body.source]}`, authorId: user.id });
  res.status(201).json({ lead: publicLead(lead) });
};

export const update: RequestHandler = (req, res) => {
  const { user } = authOf(req);
  const lead = leadOr404(String(req.params.id));
  const { ownerId, storeSize, tags, stage, ...rest } = parse(s.updateLeadBody, req.body);

  const changes: LeadUpdate = { ...rest, store_size: storeSize, tags: tags && JSON.stringify(tags) };

  if (ownerId !== undefined) {
    if (ownerId !== null && !getUserById(ownerId)) throw new HttpError(400, "That teammate wasn't found.");
    changes.owner_id = ownerId;
  }

  const moved = stage !== undefined && stage !== lead.stage;
  if (moved) {
    if (!isStage(stage)) throw new HttpError(400, "That stage doesn't exist. Refresh the page to see the current stages.");
    changes.stage = stage;
    // Leaving "paid" means the merchant is no longer a customer
    if (stage === PAID) changes.paid_at = Date.now();
    else if (lead.stage === PAID) changes.paid_at = null;
    changes.last_activity = `Moved to ${stageLabel(stage)}`;
  }

  const updated = updateLead(lead.id, changes);
  if (moved) {
    addActivity({ leadId: lead.id, kind: "stage", text: `Moved from ${stageLabel(lead.stage)} to ${stageLabel(stage)}`, authorId: user.id });
  }
  res.json({ lead: publicLead(updated) });
};

export const categories: RequestHandler = (_req, res) => {
  res.json({ categories: listCategories() });
};
