import { config } from "../config.js";
import { prisma } from "../db.js";
import { CHURNED, PAID, listLeads, type Channel } from "./leads.js";
import { listStages } from "./pipeline.js";

const DAY = 24 * 60 * 60_000;

// "2026-10-25" in the business time zone; months compare on the first 7 characters
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabelFormat = new Intl.DateTimeFormat("en-IN", { timeZone: config.timeZone, day: "numeric", month: "short" });
const dayKey = (ts: number) => dayKeyFormat.format(ts);
const monthKey = (ts: number) => dayKey(ts).slice(0, 7);

function previousMonthKey(key: string) {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Percentage change, one decimal; null when there's nothing to compare against */
const change = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);

type Row = { created_at: number; paid_at: number | null; stage: string; source: Channel; first_reply_min: number | null; trial_day: number | null };

/** Everything the overview page shows, worked out from the leads table */
export async function dashboard(now = Date.now()) {
  // Six months back covers every window below
  const since = new Date(now - 190 * DAY);
  const [records, stages, latest] = await Promise.all([
    prisma.lead.findMany({
      where: { OR: [{ createdAt: { gte: since } }, { paidAt: { gte: since } }] },
      select: { createdAt: true, paidAt: true, stage: true, source: true, firstReplyMin: true, trialDay: true },
    }),
    listStages(),
    listLeads({ page: 1, pageSize: 5 }),
  ]);
  const rows: Row[] = records.map((r) => ({
    created_at: r.createdAt.getTime(),
    paid_at: r.paidAt?.getTime() ?? null,
    stage: r.stage,
    source: r.source as Channel,
    first_reply_min: r.firstReplyMin,
    trial_day: r.trialDay,
  }));

  // New leads today, against the same point in the day a week ago
  const today = dayKey(now);
  const weekAgo = now - 7 * DAY;
  const weekAgoKey = dayKey(weekAgo);
  const newToday = rows.filter((r) => dayKey(r.created_at) === today).length;
  const newLastWeek = rows.filter((r) => r.created_at <= weekAgo && dayKey(r.created_at) === weekAgoKey).length;

  // Median first reply for leads that arrived this week, against the week before
  const replies = (from: number, to: number) =>
    rows.filter((r) => r.created_at >= from && r.created_at < to && r.first_reply_min !== null).map((r) => r.first_reply_min!);
  const replyNow = median(replies(now - 7 * DAY, now + 1));
  const replyBefore = median(replies(now - 14 * DAY, now - 7 * DAY));

  // Trial → paid over the last 90 days: of leads that reached a trial, how many paid
  const hasTrial = stages.some((s) => s.id === "trial");
  const recent = rows.filter((r) => r.created_at >= now - 90 * DAY);
  const reachedTrial = recent.filter((r) => r.stage === "trial" || r.stage === PAID || (r.stage === CHURNED && r.trial_day !== null));
  const paidFromTrial = reachedTrial.filter((r) => r.stage === PAID).length;

  // New paying stores this month, against last month
  const month = monthKey(now);
  const lastMonth = previousMonthKey(month);
  const paidThisMonth = rows.filter((r) => r.paid_at !== null && monthKey(r.paid_at) === month).length;
  const paidLastMonth = rows.filter((r) => r.paid_at !== null && monthKey(r.paid_at) === lastMonth).length;

  // Daily leads captured and leads that became paying, last 30 days
  const days = Array.from({ length: 30 }, (_, i) => now - (29 - i) * DAY);
  const keys = days.map(dayKey);
  const index = new Map(keys.map((k, i) => [k, i]));
  const dailyLeads = new Array<number>(30).fill(0);
  const dailyPaid = new Array<number>(30).fill(0);
  for (const r of rows) {
    const ci = index.get(dayKey(r.created_at));
    if (ci !== undefined) dailyLeads[ci]++;
    if (r.paid_at !== null && r.stage === PAID) {
      const pi = index.get(dayKey(r.paid_at));
      if (pi !== undefined) dailyPaid[pi]++;
    }
  }

  // Funnel over the last 90 days: how many leads got at least as far as each stage. Churned leads are left out
  // because it isn't recorded where they dropped off.
  const position = new Map(stages.map((s, i) => [s.id, i]));
  const cohort = recent.filter((r) => position.has(r.stage));
  const funnel = stages.map((s, i) => ({ id: s.id, label: s.label, value: cohort.filter((r) => position.get(r.stage)! >= i).length }));

  // Busiest source this week
  const thisWeek = rows.filter((r) => r.created_at >= now - 7 * DAY);
  const priorWeek = rows.filter((r) => r.created_at >= now - 14 * DAY && r.created_at < now - 7 * DAY);
  const bySource = new Map<Channel, number>();
  for (const r of thisWeek) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  const top = [...bySource.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    timeZone: config.timeZone,
    newLeadsToday: { count: newToday, sameTimeLastWeek: newLastWeek, change: change(newToday, newLastWeek) },
    firstReply: { medianMin: replyNow, previousMedianMin: replyBefore },
    trialToPaid: hasTrial && reachedTrial.length ? { rate: Math.round((paidFromTrial / reachedTrial.length) * 1000) / 10, reachedTrial: reachedTrial.length, paid: paidFromTrial } : null,
    payingThisMonth: { count: paidThisMonth, lastMonth: paidLastMonth },
    daily: { labels: days.map((d) => dayLabelFormat.format(d)), leads: dailyLeads, paid: dailyPaid },
    funnel: { steps: funnel, total: cohort.length },
    topSource: top
      ? { source: top[0], count: top[1], share: Math.round((top[1] / thisWeek.length) * 100), change: change(top[1], priorWeek.filter((r) => r.source === top[0]).length) }
      : null,
    latest: latest.leads,
  };
}
