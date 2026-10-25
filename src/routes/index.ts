import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import * as customers from "../controllers/customers.controller.js";
import { getDashboard } from "../controllers/dashboard.controller.js";
import { getPipeline, savePipeline } from "../controllers/pipeline.controller.js";
import { authRoutes } from "./auth.routes.js";
import { leadsRoutes } from "./leads.routes.js";

/** Every API route, mounted at /api */
export const apiRoutes = Router();

apiRoutes.get("/health", (_req, res) => {
  res.json({ ok: true });
});

apiRoutes.use("/auth", authRoutes);

// CRM
apiRoutes.use("/leads", leadsRoutes);
apiRoutes.get("/customers", requireAuth, customers.list);
apiRoutes.get("/pipeline", requireAuth, getPipeline);
apiRoutes.put("/pipeline", requireRole("admin", "manager"), savePipeline);
apiRoutes.get("/dashboard", requireAuth, getDashboard);
