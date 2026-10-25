import { db } from "../db.js";
import { CHURNED } from "./leads.js";

export const STAGE_COLORS = ["info", "accent", "aqua", "warning", "success", "secondary", "error"] as const;
export type StageColor = (typeof STAGE_COLORS)[number];
export type Stage = { id: string; label: string; color: StageColor };

export const listStages = () => db.prepare("SELECT id, label, color FROM stages ORDER BY position").all() as Stage[];

export const isStage = (id: string) => id === CHURNED || listStages().some((s) => s.id === id);

/** Lead count per stage id, churned included */
export function stageCounts() {
  const rows = db.prepare("SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage").all() as { stage: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.stage, r.n])) as Record<string, number>;
}

export function pipelineWithCounts() {
  const counts = stageCounts();
  return {
    stages: listStages().map((s) => ({ ...s, count: counts[s.id] ?? 0 })),
    churned: { id: CHURNED, label: "Churned", color: "error" as const, count: counts[CHURNED] ?? 0 },
  };
}

/**
 * Replaces the pipeline with a new ordered list. Returns an error message if the change would
 * leave leads in a stage that no longer exists.
 */
export function replaceStages(stages: Stage[]): string | null {
  const counts = stageCounts();
  const kept = new Set(stages.map((s) => s.id));
  const orphaned = listStages().filter((s) => !kept.has(s.id) && (counts[s.id] ?? 0) > 0);
  if (orphaned.length) {
    const s = orphaned[0];
    return `"${s.label}" still has ${counts[s.id]} ${counts[s.id] === 1 ? "lead" : "leads"}. Move them to another stage first.`;
  }
  db.transaction(() => {
    db.prepare("DELETE FROM stages").run();
    const insert = db.prepare("INSERT INTO stages (id, label, color, position) VALUES (?, ?, ?, ?)");
    stages.forEach((s, i) => insert.run(s.id, s.label, s.color, i));
  })();
  return null;
}
