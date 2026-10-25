import { prisma, type Activity } from "../db.js";

/** Kinds a person can log by hand; the rest are written by the system */
export const LOGGABLE_KINDS = ["note", "call", "whatsapp", "email", "meeting"] as const;
export const ACTIVITY_KINDS = [...LOGGABLE_KINDS, "trial", "message", "merge", "auto", "capture", "stage"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const withAuthor = { author: { select: { name: true } } } as const;

/** The only shape of an activity that leaves the API (timestamps as epoch ms) */
const publicActivity = (a: Activity & { author: { name: string } | null }) => ({
  id: a.id,
  kind: a.kind as ActivityKind,
  text: a.text,
  authorId: a.authorId,
  authorName: a.author?.name ?? null,
  createdAt: a.createdAt.getTime(),
});

export const listActivities = async (leadId: string) =>
  (await prisma.activity.findMany({ where: { leadId }, include: withAuthor, orderBy: { createdAt: "desc" } })).map(publicActivity);

export const getActivity = (id: string) => prisma.activity.findUnique({ where: { id } });

export async function addActivity(input: { leadId: string; kind: ActivityKind; text: string; authorId?: string | null; at?: number }) {
  const activity = await prisma.activity.create({
    data: { leadId: input.leadId, kind: input.kind, text: input.text, authorId: input.authorId ?? null, createdAt: new Date(input.at ?? Date.now()) },
    include: withAuthor,
  });
  return publicActivity(activity);
}

export const deleteActivity = (id: string) => prisma.activity.deleteMany({ where: { id } });
