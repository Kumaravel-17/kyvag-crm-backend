import { db } from "../db.js";

export const CHANNELS = ["instagram", "facebook", "whatsapp", "google", "youtube", "website", "linkedin", "csv", "referral", "email", "sms"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", google: "Google Ads", youtube: "YouTube", website: "Website",
  linkedin: "LinkedIn", csv: "CSV import", referral: "Referral", email: "Email", sms: "SMS",
};

export const PLATFORMS =["Shopify", "WooCommerce", "Magento", "Custom", "None"] as const;
export const STORE_SIZES = ["Solo", "2–10", "11–50", "50+"] as const;

/** Leads that dropped out. Not part of the pipeline, so it can't be renamed or removed. */
export const CHURNED = "churned";
/** The stage that makes a lead a customer */
export const PAID = "paid";

export type LeadRow = {
  id: string;
  seq: number;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  domain: string | null;
  city: string | null;
  language: string | null;
  source: Channel;
  stage: string;
  score: number;
  owner_id: string | null;
  platform: string;
  store_size: string | null;
  category: string | null;
  tags: string;
  utm: string | null;
  duplicates: string;
  last_activity: string | null;
  first_reply_min: number | null;
  trial_day: number | null;
  created_at: number;
  updated_at: number;
  paid_at: number | null;
};

type LeadWithOwner = LeadRow & { owner_name: string | null };

/** The only shape of a lead that leaves the API */
export const publicLead = (l: LeadWithOwner) => ({
  id: l.id,
  name: l.name,
  company: l.company,
  email: l.email,
  phone: l.phone,
  domain: l.domain,
  city: l.city,
  language: l.language,
  source: l.source,
  stage: l.stage,
  score: l.score,
  ownerId: l.owner_id,
  ownerName: l.owner_name,
  platform: l.platform,
  storeSize: l.store_size,
  category: l.category,
  tags: JSON.parse(l.tags) as string[],
  utm: l.utm ? (JSON.parse(l.utm) as { source: string; campaign: string; adset: string; ad: string }) : null,
  duplicates: JSON.parse(l.duplicates) as Channel[],
  lastActivity: l.last_activity,
  firstReplyMin: l.first_reply_min,
  trialDay: l.trial_day,
  createdAt: l.created_at,
  updatedAt: l.updated_at,
  paidAt: l.paid_at,
});

const SELECT = "SELECT l.*, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id";

export const getLead = (id: string) => db.prepare(`${SELECT} WHERE l.id = ?`).get(id) as LeadWithOwner | undefined;

export type LeadFilters = { q?: string; stage?: string; source?: string; page: number; pageSize: number };

/** Newest first, filtered and paged in SQL */
export function listLeads({ q, stage, source, page, pageSize }: LeadFilters) {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (stage) { where.push("l.stage = @stage"); params.stage = stage; }
  if (source) { where.push("l.source = @source"); params.source = source; }
  if (q) {
    // % and _ in the search box are matched literally
    params.q = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      `(l.name LIKE @q ESCAPE '\\' OR l.company LIKE @q ESCAPE '\\' OR l.domain LIKE @q ESCAPE '\\' OR l.email LIKE @q ESCAPE '\\'
        OR l.phone LIKE @q ESCAPE '\\' OR l.city LIKE @q ESCAPE '\\' OR l.id LIKE @q ESCAPE '\\')`,
    );
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM leads l ${clause}`).get(params) as { n: number }).n;
  const rows = db
    .prepare(`${SELECT} ${clause} ORDER BY l.created_at DESC, l.seq DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as LeadWithOwner[];
  return { leads: rows.map(publicLead), total, page, pageSize };
}

export type NewLead = {
  name: string;
  company: string;
  phone?: string | null;
  email?: string | null;
  domain?: string | null;
  city?: string | null;
  language?: string | null;
  source: Channel;
  stage: string;
  score?: number;
  ownerId?: string | null;
  platform?: string;
  storeSize?: string | null;
  category?: string | null;
  tags?: string[];
  utm?: { source: string; campaign: string; adset: string; ad: string } | null;
  duplicates?: Channel[];
  lastActivity?: string | null;
  firstReplyMin?: number | null;
  trialDay?: number | null;
  createdAt?: number;
  paidAt?: number | null;
  /** Keeps a known id (seed data); otherwise the next number is issued */
  id?: string;
};

export function createLead(input: NewLead) {
  const now = Date.now();
  const createdAt = input.createdAt ?? now;
  const seq = input.id
    ? Number(input.id.replace(/\D/g, ""))
    : ((db.prepare("SELECT MAX(seq) AS n FROM leads").get() as { n: number | null }).n ?? 2000) + 1;
  const id = input.id ?? `L-${seq}`;
  db.prepare(
    `INSERT INTO leads (id, seq, name, company, email, phone, domain, city, language, source, stage, score, owner_id, platform, store_size,
       category, tags, utm, duplicates, last_activity, first_reply_min, trial_day, created_at, updated_at, paid_at)
     VALUES (@id, @seq, @name, @company, @email, @phone, @domain, @city, @language, @source, @stage, @score, @owner_id, @platform, @store_size,
       @category, @tags, @utm, @duplicates, @last_activity, @first_reply_min, @trial_day, @created_at, @updated_at, @paid_at)`,
  ).run({
    id,
    seq,
    name: input.name,
    company: input.company,
    email: input.email ?? null,
    phone: input.phone ?? null,
    domain: input.domain ?? null,
    city: input.city ?? null,
    language: input.language ?? null,
    source: input.source,
    stage: input.stage,
    score: input.score ?? 50,
    owner_id: input.ownerId ?? null,
    platform: input.platform ?? "None",
    store_size: input.storeSize ?? null,
    category: input.category ?? null,
    tags: JSON.stringify(input.tags ?? []),
    utm: input.utm ? JSON.stringify(input.utm) : null,
    duplicates: JSON.stringify(input.duplicates ?? []),
    last_activity: input.lastActivity ?? null,
    first_reply_min: input.firstReplyMin ?? null,
    trial_day: input.trialDay ?? null,
    created_at: createdAt,
    updated_at: createdAt,
    paid_at: input.paidAt ?? (input.stage === PAID ? createdAt : null),
  });
  return getLead(id)!;
}

const UPDATABLE = ["name", "company", "email", "phone", "domain", "city", "language", "source", "stage", "score", "owner_id", "platform", "store_size", "category", "tags", "last_activity", "paid_at"] as const;
export type LeadUpdate = Partial<Pick<LeadRow, (typeof UPDATABLE)[number]>>;

export function updateLead(id: string, changes: LeadUpdate) {
  const keys = UPDATABLE.filter((k) => changes[k] !== undefined);
  if (keys.length) {
    const sets = keys.map((k) => `${k} = @${k}`).join(", ");
    db.prepare(`UPDATE leads SET ${sets}, updated_at = @now WHERE id = @id`).run({ ...changes, id, now: Date.now() });
  }
  return getLead(id)!;
}

/** For suggestions in the "type of business" box */
export const listCategories = () =>
  (db.prepare("SELECT DISTINCT category FROM leads WHERE category IS NOT NULL AND category != '' ORDER BY category").all() as { category: string }[]).map((r) => r.category);
