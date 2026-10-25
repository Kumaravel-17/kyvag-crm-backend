// Creates the development account. With --demo it also adds sample leads, for trying out the dashboard and lists.
// Safe to run more than once: existing emails are skipped, and demo leads are only added to an empty database.
import { hashPassword } from "./auth/crypto.js";
import { createUser, getUserByEmail } from "./auth/users.js";
import { config } from "./config.js";
import { ensureDefaultStages, prisma } from "./db.js";
import { seedLeads } from "./seed/leads.js";

if (config.isProd) {
  console.error("Refusing to seed the demo account in production.");
  process.exit(1);
}

const password = process.env.SEED_PASSWORD ?? "Kyvag@2026";

const ACCOUNT = { email: "kumaravel@kyvag.com", name: "Kumaravel M.", role: "admin" as const, title: "Head of Sales", phone: "+91 98765 43210" };

await ensureDefaultStages();

const existing = await getUserByEmail(ACCOUNT.email);
console.log(`${existing ? "exists " : "created"}  ${ACCOUNT.email}`);
const user = existing ?? (await createUser({ ...ACCOUNT, passwordHash: await hashPassword(password) }));

if (process.argv.includes("--demo")) {
  // The sample leads were written for four reps (r1–r4); with one account, they all belong to it
  const leads = await seedLeads({ r1: user.id, r2: user.id, r3: user.id, r4: user.id });
  console.log(leads ? `created  ${leads} demo leads with activity` : "skipped  demo leads (database already has leads)");
}
console.log(`\nPassword: ${password}`);
await prisma.$disconnect();
