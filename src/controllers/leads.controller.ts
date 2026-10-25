import type { RequestHandler } from "express";
import { authOf } from "../auth/middleware.js";
import { getUserById } from "../auth/users.js";
import { addActivity } from "../crm/activities.js";
import { CHANNEL_LABEL, CHURNED, PAID, createLead, getLead, listCategories, listLeads, publicLead, updateLead } from "../crm/leads.js";
import { isStage, listStages } from "../crm/pipeline.js";
import * as s from "../crm/schemas.js";
import type { Prisma } from "../db.js";
import { HttpError, parse } from "../http.js";

async function stageLabel(id: string) {
  if (id === CHURNED) return "Churned";
  return (await listStages()).find((st) => st.id === id)?.label ?? id;
}

async function leadOr404(id: string) {
  const lead = await getLead(id);
  if (!lead) throw new HttpError(404, "That lead wasn't found. It may have been removed.");
  return lead;
}

export const list: RequestHandler = async (req, res) => {
  const { stage, ...filters } = parse(s.leadQuery, req.query);
  res.json(await listLeads({ ...filters, stage: stage === "all" ? undefined : stage }));
};

export const get: RequestHandler = async (req, res) => {
  res.json({ lead: publicLead(await leadOr404(String(req.params.id))) });
};

export const create: RequestHandler = async (req, res) => {
  const { user } = authOf(req);
  const body = parse(s.createLeadBody, req.body);
  const [first] = await listStages();
  const lead = await createLead({ ...body, stage: first.id, ownerId: user.id, lastActivity: `Added by ${user.name}` });
  await addActivity({ leadId: lead.id, kind: "capture", text: `Lead added by hand · ${CHANNEL_LABEL[body.source]}`, authorId: user.id });
  res.status(201).json({ lead: publicLead(lead) });
};

export const update: RequestHandler = async (req, res) => {
  const { user } = authOf(req);
  const lead = await leadOr404(String(req.params.id));
  const { ownerId, stage, ...changes } = parse(s.updateLeadBody, req.body);
  const data: Prisma.LeadUncheckedUpdateInput = { ...changes };

  if (ownerId !== undefined) {
    if (ownerId !== null && !(await getUserById(ownerId))) throw new HttpError(400, "That account wasn't found.");
    data.ownerId = ownerId;
  }

  const moved = stage !== undefined && stage !== lead.stage;
  if (moved) {
    if (!(await isStage(stage))) throw new HttpError(400, "That stage doesn't exist. Refresh the page to see the current stages.");
    data.stage = stage;
    // Leaving "paid" means the merchant is no longer a customer
    if (stage === PAID) data.paidAt = new Date();
    else if (lead.stage === PAID) data.paidAt = null;
    data.lastActivity = `Moved to ${await stageLabel(stage)}`;
  }

  const updated = await updateLead(lead.id, data);
  if (moved) {
    const text = `Moved from ${await stageLabel(lead.stage)} to ${await stageLabel(stage)}`;
    await addActivity({ leadId: lead.id, kind: "stage", text, authorId: user.id });
  }
  res.json({ lead: publicLead(updated) });
};

export const categories: RequestHandler = async (_req, res) => {
  res.json({ categories: await listCategories() });
};
