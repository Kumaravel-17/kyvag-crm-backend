import { randomUUID } from "node:crypto";
import { db } from "../db.js";

/** Kinds a person can log by hand; the rest are written by the system */
export const LOGGABLE_KINDS = ["note", "call", "whatsapp", "email", "meeting"] as const;
export const ACTIVITY_KINDS = [...LOGGABLE_KINDS, "trial", "message", "merge", "auto", "capture", "stage"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

type ActivityRow = { id: string; lead_id: string; kind: ActivityKind; text: string; author_id: string | null; author_name: string | null; created_at: number };

const publicActivity = (a: ActivityRow) => ({
  id: a.id,
  kind: a.kind,
  text: a.text,
  authorId: a.author_id,
  authorName: a.author_name,
  createdAt: a.created_at,
});

const SELECT = "SELECT a.*, u.name AS author_name FROM activities a LEFT JOIN users u ON u.id = a.author_id";

export const listActivities = (leadId: string) =>
  (db.prepare(`${SELECT} WHERE a.lead_id = ? ORDER BY a.created_at DESC`).all(leadId) as ActivityRow[]).map(publicActivity);

export const getActivity = (id: string) => db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as ActivityRow | undefined;

export function addActivity(input: { leadId: string; kind: ActivityKind; text: string; authorId?: string | null; at?: number }) {
  const id = randomUUID();
  db.prepare("INSERT INTO activities (id, lead_id, kind, text, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, input.leadId, input.kind, input.text, input.authorId ?? null, input.at ?? Date.now(),
  );
  return publicActivity(getActivity(id)!);
}

export const deleteActivity = (id: string) => db.prepare("DELETE FROM activities WHERE id = ?").run(id);
