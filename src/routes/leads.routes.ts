import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import * as activities from "../controllers/activities.controller.js";
import * as leads from "../controllers/leads.controller.js";

export const leadsRoutes = Router();

leadsRoutes.use(requireAuth);

leadsRoutes.get("/", leads.list);
leadsRoutes.post("/", leads.create);
leadsRoutes.get("/categories", leads.categories);
leadsRoutes.get("/:id", leads.get);
leadsRoutes.patch("/:id", leads.update);

// Activity timeline for one lead
leadsRoutes.get("/:id/activities", activities.list);
leadsRoutes.post("/:id/activities", activities.create);
leadsRoutes.delete("/:id/activities/:activityId", activities.remove);
