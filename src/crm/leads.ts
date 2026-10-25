import { Prisma, prisma, type LeadRecord } from "../db.js";

export const CHANNELS = ["instagram", "facebook", "whatsapp", "google", "youtube", "website", "linkedin", "csv", "referral", "email", "sms"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", google: "Google Ads", youtube: "YouTube", website: "Website",
  linkedin: "LinkedIn", csv: "CSV import", referral: "Referral", email: "Email", sms: "SMS",
};

export const PLATFORMS = ["Shopify", "WooCommerce", "Magento", "Custom", "None"] as const;
export const STORE_SIZES = ["Solo", "2–10", "11–50", "50+"] as const;

/** Leads that dropped out. Not part of the pipeline, so it can't be renamed or removed. */
export const CHURNED = "churned";
/** The stage that makes a lead a customer */
export const PAID = "paid";

type Utm = { source: string; campaign: string; adset: string; ad: string };
const withOwner = { owner: { select: { name: true } } } as const;
type LeadWithOwner = LeadRecord & { owner: { name: string } | null };

/** The only shape of a lead that leaves the API (timestamps as epoch ms) */
export const publicLead = (l: LeadWithOwner) => ({
  id: l.id,
  name: l.name,
  company: l.company,
  email: l.email,
  phone: l.phone,
  domain: l.domain,
  city: l.city,
  language: l.language,
  source: l.source as Channel,
  stage: l.stage,
  score: l.score,
  ownerId: l.ownerId,
  ownerName: l.owner?.name ?? null,
  platform: l.platform,
  storeSize: l.storeSize,
  category: l.category,
  tags: l.tags,
  utm: (l.utm as Utm | null) ?? null,
  duplicates: l.duplicates as Channel[],
  lastActivity: l.lastActivity,
  firstReplyMin: l.firstReplyMin,
  trialDay: l.trialDay,
  createdAt: l.createdAt.getTime(),
  updatedAt: l.updatedAt.getTime(),
  paidAt: l.paidAt?.getTime() ?? null,
});

export const getLead = (id: string) => prisma.lead.findUnique({ where: { id }, include: withOwner });

export type LeadFilters = { q?: string; stage?: string; source?: string; page: number; pageSize: number };

/** Newest first, filtered and paged in the database */
export async function listLeads({ q, stage, source, page, pageSize }: LeadFilters) {
  // Prisma passes % and _ through to ILIKE as wildcards; escaped, the search box matches them literally
  const term = q?.replace(/[\\%_]/g, (c) => `\\${c}`);
  const like = (field: "name" | "company" | "domain" | "email" | "phone" | "city" | "id") => ({ [field]: { contains: term, mode: "insensitive" as const } });
  const where: Prisma.LeadWhereInput = {
    ...(stage ? { stage } : {}),
    ...(source ? { source } : {}),
    ...(q ? { OR: (["name", "company", "domain", "email", "phone", "city", "id"] as const).map(like) } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.lead.count({ where }),
    prisma.lead.findMany({ where, include: withOwner, orderBy: [{ createdAt: "desc" }, { seq: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
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
  utm?: Utm | null;
  duplicates?: Channel[];
  lastActivity?: string | null;
  firstReplyMin?: number | null;
  trialDay?: number | null;
  /** Epoch ms; now by default */
  createdAt?: number;
  paidAt?: number | null;
  /** Keeps a known id (seed data); otherwise the next number is issued */
  id?: string;
};

const isUniqueClash = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createLead(input: NewLead) {
  const { id: fixedId, createdAt: createdMs, paidAt, utm, ...fields } = input;
  const createdAt = new Date(createdMs ?? Date.now());
  // Two leads added at the same moment can pick the same next number; the loser retries with the one after
  for (let attempt = 0; ; attempt++) {
    const seq = fixedId ? Number(fixedId.replace(/\D/g, "")) : ((await prisma.lead.aggregate({ _max: { seq: true } }))._max.seq ?? 2000) + 1;
    try {
      return await prisma.lead.create({
        data: {
          ...fields,
          id: fixedId ?? `L-${seq}`,
          seq,
          utm: utm ?? Prisma.DbNull,
          createdAt,
          updatedAt: createdAt,
          paidAt: paidAt != null ? new Date(paidAt) : input.stage === PAID ? createdAt : null,
        },
        include: withOwner,
      });
    } catch (e) {
      if (fixedId || attempt >= 4 || !isUniqueClash(e)) throw e;
    }
  }
}

export const updateLead = (id: string, changes: Prisma.LeadUncheckedUpdateInput) =>
  prisma.lead.update({ where: { id }, data: changes, include: withOwner });

/** For suggestions in the "type of business" box */
export async function listCategories() {
  const rows = await prisma.lead.findMany({
    where: { category: { not: null }, NOT: { category: "" } },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category!);
}
