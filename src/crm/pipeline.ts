import { prisma } from "../db.js";
import { CHURNED } from "./leads.js";

export const STAGE_COLORS = ["info", "accent", "aqua", "warning", "success", "secondary", "error"] as const;
export type StageColor = (typeof STAGE_COLORS)[number];
export type Stage = { id: string; label: string; color: StageColor };

export const listStages = () =>
  prisma.stage.findMany({ select: { id: true, label: true, color: true }, orderBy: { position: "asc" } }) as Promise<Stage[]>;

export const isStage = async (id: string) => id === CHURNED || (await prisma.stage.count({ where: { id } })) > 0;

/** Lead count per stage id, churned included */
export async function stageCounts() {
  const rows = await prisma.lead.groupBy({ by: ["stage"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.stage, r._count._all])) as Record<string, number>;
}

export async function pipelineWithCounts() {
  const [stages, counts] = await Promise.all([listStages(), stageCounts()]);
  return {
    stages: stages.map((s) => ({ ...s, count: counts[s.id] ?? 0 })),
    churned: { id: CHURNED, label: "Churned", color: "error" as const, count: counts[CHURNED] ?? 0 },
  };
}

/**
 * Replaces the pipeline with a new ordered list. Returns an error message if the change would
 * leave leads in a stage that no longer exists.
 */
export async function replaceStages(stages: Stage[]): Promise<string | null> {
  const [current, counts] = await Promise.all([listStages(), stageCounts()]);
  const kept = new Set(stages.map((s) => s.id));
  const orphaned = current.filter((s) => !kept.has(s.id) && (counts[s.id] ?? 0) > 0);
  if (orphaned.length) {
    const s = orphaned[0];
    return `"${s.label}" still has ${counts[s.id]} ${counts[s.id] === 1 ? "lead" : "leads"}. Move them to another stage first.`;
  }
  await prisma.$transaction([
    prisma.stage.deleteMany(),
    prisma.stage.createMany({ data: stages.map((s, position) => ({ ...s, position })) }),
  ]);
  return null;
}
