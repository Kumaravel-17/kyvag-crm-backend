// Demo leads for development: the frontend's original samples plus generated ones over the last 90 days, so the dashboard,
// filters and paging have real numbers to work with. Uses a fixed random seed, so every run produces the same data.
import { addActivity } from "../crm/activities.js";
import { CHANNEL_LABEL, PAID, createLead, type Channel } from "../crm/leads.js";
import { prisma } from "../db.js";
import { SAMPLE_LEADS } from "./sampleLeads.js";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Aarav", "Diya", "Ishaan", "Kavya", "Vihaan", "Ananya", "Arjun", "Saanvi", "Kabir", "Meera", "Rohan", "Nisha", "Aditya", "Pooja", "Siddharth", "Lakshmi", "Varun", "Sneha", "Harish", "Divya", "Imran", "Zoya", "Gurpreet", "Tanvi", "Manoj", "Ritu", "Naveen", "Shreya", "Karthik", "Farah"];
const LAST = ["Sharma", "Iyer", "Nair", "Reddy", "Patel", "Menon", "Gupta", "Khan", "Singh", "Rao", "Das", "Joshi", "Pillai", "Kulkarni", "Shah", "Banerjee", "Chopra", "Naidu", "Mehta", "Verma"];
const CATEGORIES: [string, string[]][] = [
  ["Sarees & ethnicwear", ["Sarees", "Silks", "Ethnic", "Weaves"]],
  ["Handicrafts", ["Crafts", "Handmade", "Artisans"]],
  ["Home décor", ["Decor", "Living", "Interiors"]],
  ["Spices", ["Spices", "Masala Co."]],
  ["Food & beverage", ["Bakes", "Foods", "Kitchen", "Brew"]],
  ["Jewellery", ["Jewels", "Gold", "Ornaments"]],
  ["Beauty & wellness", ["Naturals", "Botanicals", "Ayurveda"]],
  ["Toys & kids", ["Kids", "Toys", "Little Ones"]],
  ["Organic produce", ["Organics", "Farms", "Harvest"]],
];
const PREFIX = ["Lotus", "Anand", "Sri Krishna", "Urban", "Desi", "Kaveri", "Indigo", "Saffron", "Mango Tree", "Tulsi", "Peacock", "Banyan", "Monsoon", "Chandni", "Coastal"];
const PLACES: [string, string][] = [
  ["Chennai", "Tamil"], ["Coimbatore", "Tamil"], ["Madurai", "Tamil"], ["Bengaluru", "Kannada"], ["Mysuru", "Kannada"], ["Hyderabad", "Telugu"],
  ["Kochi", "Malayalam"], ["Mumbai", "Marathi"], ["Pune", "Marathi"], ["Ahmedabad", "Gujarati"], ["Surat", "Gujarati"], ["Delhi", "Hindi"],
  ["Jaipur", "Hindi"], ["Lucknow", "Hindi"], ["Kolkata", "Bengali"], ["Chandigarh", "Punjabi"],
];
const SOURCES: [Channel, number][] = [["instagram", 30], ["whatsapp", 20], ["facebook", 12], ["google", 12], ["website", 10], ["youtube", 6], ["linkedin", 4], ["referral", 4], ["csv", 2]];
const PLATFORMS: [string, number][] = [["None", 50], ["Shopify", 20], ["WooCommerce", 12], ["Custom", 12], ["Magento", 6]];
const SIZES: [string, number][] = [["Solo", 50], ["2–10", 32], ["11–50", 14], ["50+", 4]];
// Chance of moving on from each stage to the next: new → contacted → demo → trial → paid
const ADVANCE = [0.82, 0.48, 0.78, 0.42];
const STAGES = ["new", "contacted", "demo", "trial", PAID];
const LAST_ACTIVITY: Record<string, string[]> = {
  new: ["Free-trial signup", "Sent a DM asking about pricing", "Filled the website form"],
  contacted: ["Replied on WhatsApp", "Asked about COD", "Asked for a callback"],
  demo: ["Booked a demo", "Rescheduled the demo", "Booked onboarding call"],
  trial: ["Started trial", "Added first 10 products", "Asked for a quote on the Growth plan"],
  paid: ["Became a paying customer"],
  churned: ["Cancelled trial", "Stopped replying", "Went with another platform"],
};

const pick = <T>(r: () => number, list: T[]) => list[Math.floor(r() * list.length)];
function weighted<T>(r: () => number, list: [T, number][]) {
  let n = r() * list.reduce((t, [, w]) => t + w, 0);
  for (const [v, w] of list) if ((n -= w) < 0) return v;
  return list[0][0];
}
const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const ageMinutes = (label: string) => {
  const m = label.match(/(\d+)\s*(min|h|d)/);
  return m ? Number(m[1]) * { min: 1, h: 60, d: 1440 }[m[2] as "min" | "h" | "d"] : 0;
};

/** Capture, auto-reply and latest touch, so every lead's timeline starts out consistent with its fields */
async function seedTimeline(leadId: string, source: Channel, ad: string | undefined, createdAt: number, firstReplyMin: number | null, last: string, lastAt: number) {
  await addActivity({ leadId, kind: "capture", text: `Lead captured · ${CHANNEL_LABEL[source]}${ad && ad !== "—" ? ` · ${ad}` : ""}`, at: createdAt });
  if (firstReplyMin !== null) {
    const seconds = Math.round(firstReplyMin * 60);
    const after = seconds < 60 ? `${seconds} seconds` : `${Math.round(firstReplyMin)} min`;
    await addActivity({ leadId, kind: "auto", text: `First reply sent on ${CHANNEL_LABEL[source]} in ${after}`, at: createdAt + firstReplyMin * MIN });
  }
  if (lastAt > createdAt + (firstReplyMin ?? 0) * MIN) {
    const kind = /call/i.test(last) ? "call" : /demo|meeting/i.test(last) ? "meeting" : /whatsapp/i.test(last) ? "whatsapp" : /trial|product|quote|paying/i.test(last) ? "trial" : "message";
    await addActivity({ leadId, kind, text: last, at: lastAt });
  }
}

export async function seedLeads(repIds: Record<string, string>, now = Date.now()) {
  if ((await prisma.lead.count()) > 0) return 0;
  const reps = Object.values(repIds);
  let created = 0;

  {
    // The hand-written samples keep their ids and ages
    for (const l of SAMPLE_LEADS) {
      const createdAt = now - ageMinutes(l.created) * MIN;
      const paidAt = l.stage === PAID ? Math.min(now - 2 * 60 * MIN, createdAt + 12 * DAY) : null;
      await createLead({
        id: l.id, name: l.name, company: l.company, email: l.email, phone: l.phone, domain: l.domain, city: l.city, language: l.language,
        source: l.source as Channel, stage: l.stage, score: l.score, ownerId: repIds[l.ownerId] ?? null, platform: l.platform,
        storeSize: l.storeSize, category: l.category, tags: l.tags, utm: l.utm, duplicates: (l.duplicates ?? []) as Channel[],
        lastActivity: l.lastActivity, firstReplyMin: l.firstReplyMin, trialDay: l.trial?.day ?? null, createdAt, paidAt,
      });
      const lastAt = paidAt ?? Math.min(now - 5 * MIN, createdAt + Math.max(30 * MIN, (now - createdAt) * 0.8));
      await seedTimeline(l.id, l.source as Channel, l.utm.ad, createdAt, l.firstReplyMin, l.lastActivity, lastAt);
      created++;
    }

    // Generated leads, a little more each day, oldest first so ids rise with time
    const r = rng(2026);
    const generated: { createdAt: number }[] = [];
    for (let d = 89; d >= 0; d--) {
      const perDay = Math.round(3 + (89 - d) * 0.045 + r() * 3 - (new Date(now - d * DAY).getDay() === 0 ? 2 : 0));
      for (let i = 0; i < perDay; i++) {
        const createdAt = now - d * DAY - Math.floor(r() * 14 * 60) * MIN;
        if (createdAt < now) generated.push({ createdAt });
      }
    }
    generated.sort((a, b) => a.createdAt - b.createdAt);

    for (const [i, { createdAt }] of generated.entries()) {
      const ageDays = (now - createdAt) / DAY;
      let step = 0;
      while (step < ADVANCE.length && r() < ADVANCE[step] * Math.min(1, (ageDays + 0.5) / (3 * (step + 1)))) step++;
      let stage = STAGES[step];
      if (step >= 1 && step <= 3 && ageDays > 10 && r() < 0.28) stage = "churned";

      const first = pick(r, FIRST);
      const last = pick(r, LAST);
      const [category, nouns] = pick(r, CATEGORIES);
      const company = `${pick(r, PREFIX)} ${pick(r, nouns)}`;
      const domain = `${slug(company)}.${r() < 0.6 ? "in" : "com"}`;
      const [city, language] = pick(r, PLACES);
      const source = weighted(r, SOURCES);
      const replied = !(stage === "new" && r() < 0.15);
      const firstReplyMin = replied ? (r() < 0.72 ? Math.round((0.5 + r() * 5.5) * 10) / 10 : Math.round(6 + r() * 34)) : null;
      // Paid 6–26 days after arriving, or for newer leads somewhere between arriving and now
      const paidAt = stage === PAID ? createdAt + Math.min((6 + r() * 20) * DAY, (now - createdAt) * (0.4 + r() * 0.55)) : null;
      const lastActivity = pick(r, LAST_ACTIVITY[stage]);
      const lead = await createLead({
        id: `L-${1001 + i}`,
        name: `${first} ${last}`,
        company,
        email: `${first.toLowerCase()}@${domain}`,
        phone: `+91 9${String(Math.floor(r() * 1e4)).padStart(4, "0")} ${String(Math.floor(r() * 1e5)).padStart(5, "0")}`,
        domain,
        city,
        language,
        source,
        stage,
        score: Math.min(98, Math.round(30 + step * 9 + r() * 30)),
        ownerId: reps.length ? reps[i % reps.length] : null,
        platform: weighted(r, PLATFORMS),
        storeSize: weighted(r, SIZES),
        category,
        tags: [],
        utm: { source: source === "instagram" || source === "facebook" || source === "whatsapp" ? "meta" : source, campaign: "—", adset: "—", ad: "—" },
        lastActivity,
        firstReplyMin,
        trialDay: stage === "trial" ? 1 + Math.floor(r() * 13) : stage === "churned" && step >= 3 ? 1 + Math.floor(r() * 13) : null,
        createdAt,
        paidAt,
      });
      const lastAt = paidAt ?? Math.min(now - 5 * MIN, createdAt + Math.max(20 * MIN, (now - createdAt) * r()));
      await seedTimeline(lead.id, source, undefined, createdAt, firstReplyMin, lastActivity, lastAt);
      created++;
    }
  }
  return created;
}
