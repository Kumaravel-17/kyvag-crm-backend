import { z } from "zod";
import { LOGGABLE_KINDS } from "./activities.js";
import { CHANNELS, CHURNED, PAID, PLATFORMS, STORE_SIZES } from "./leads.js";
import { STAGE_COLORS } from "./pipeline.js";

/** Optional text where an empty box means "not set" */
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null))
  .refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email, like name@store.com.");

/** "ram kumar" → "Ram Kumar"; the rest of each word is left alone, so "McDonald" and "KYVAG" stay as typed */
const capitalized = (v: string) => v.replace(/(^|\s)(\S)/g, (_, space: string, c: string) => space + c.toUpperCase());

const personName = z.string().trim().min(1, "Enter the merchant's name.").max(100).transform(capitalized);
const storeName = z.string().trim().min(1, "Enter the store name.").max(120).transform(capitalized);

// "https://Store.com/" → "store.com"
const domain = optionalText(200).transform((v) => (v ? v.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "") : v));

export const leadQuery = z.object({
  q: z.string().trim().max(100).optional(),
  stage: z.string().trim().max(40).optional(),
  source: z.enum(CHANNELS, "Unknown lead source.").optional(),
  page: z.coerce.number("Page must be a number.").int().min(1, "Page must be 1 or more.").default(1),
  pageSize: z.coerce.number("Page size must be a number.").int().min(1).max(100, "Show at most 100 per page.").default(10),
});

export const createLeadBody = z.object({
  name: personName,
  company: storeName,
  phone: z.string().trim().min(6, "Enter a phone number.").max(30),
  email: optionalEmail,
  domain,
  city: optionalText(80),
  category: optionalText(80),
  source: z.enum(CHANNELS, "Choose where the lead came from."),
  platform: z.enum(PLATFORMS).optional(),
});

export const updateLeadBody = z.object({
  name: personName.optional(),
  company: storeName.optional(),
  phone: optionalText(30),
  email: optionalEmail,
  domain,
  source: z.enum(CHANNELS, "Choose where the lead came from.").optional(),
  city: optionalText(80),
  language: optionalText(40),
  category: optionalText(80),
  platform: z.enum(PLATFORMS).optional(),
  storeSize: z.enum(STORE_SIZES).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  score: z.number().int().min(0).max(100).optional(),
  ownerId: z.string().nullable().optional(),
  stage: z.string().trim().min(1).max(40).optional(),
});

export const activityBody = z.object({
  kind: z.enum(LOGGABLE_KINDS),
  text: z.string().trim().min(1, "Write something to log.").max(2000),
});

export const pipelineBody = z
  .object({
    stages: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9-]{1,40}$/, "Invalid stage id."),
          label: z.string().trim().min(1, "Give every stage a name.").max(40),
          color: z.enum(STAGE_COLORS),
        }),
      )
      .min(2, "Keep at least two stages.")
      .max(12, "Use 12 stages or fewer."),
  })
  .superRefine(({ stages }, ctx) => {
    const labels = stages.map((s) => s.label.toLowerCase());
    if (new Set(labels).size !== labels.length) ctx.addIssue({ code: "custom", message: "Two stages have the same name." });
    if (new Set(stages.map((s) => s.id)).size !== stages.length) ctx.addIssue({ code: "custom", message: "Two stages have the same id." });
    if (stages.some((s) => s.id === CHURNED || s.label.toLowerCase() === CHURNED)) {
      ctx.addIssue({ code: "custom", message: "“Churned” is reserved for leads that drop out." });
    }
    // Customers are the leads in "paid", so that stage has to stay (it can be renamed)
    if (!stages.some((s) => s.id === PAID)) ctx.addIssue({ code: "custom", message: "The paid stage can be renamed but not removed: customers are the leads in it." });
  });
