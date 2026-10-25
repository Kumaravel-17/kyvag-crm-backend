import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "./config.js";
import { PrismaClient } from "./generated/prisma/client.js";

// The schema lives in prisma/schema.prisma; `npm run db:migrate` changes it, `npm run db:deploy` applies it in production
export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });

export { Prisma } from "./generated/prisma/client.js";
export type { Activity, Lead as LeadRecord, Session, User } from "./generated/prisma/client.js";
export type { Role } from "./generated/prisma/enums.js";

export const ROLES = ["admin", "manager", "rep"] as const;

export const DEFAULT_STAGES = [
  { id: "new", label: "New", color: "info" },
  { id: "contacted", label: "Contacted", color: "accent" },
  { id: "demo", label: "Demo Booked", color: "aqua" },
  { id: "trial", label: "Trial", color: "warning" },
  { id: "paid", label: "Paid", color: "success" },
];

/** A fresh database starts with the default pipeline */
export async function ensureDefaultStages() {
  if ((await prisma.stage.count()) > 0) return;
  await prisma.stage.createMany({ data: DEFAULT_STAGES.map((s, position) => ({ ...s, position })), skipDuplicates: true });
}

export async function purgeExpired(now = new Date()) {
  await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.passwordToken.deleteMany({ where: { expiresAt: { lte: now } } });
}
