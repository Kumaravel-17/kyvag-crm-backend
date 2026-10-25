// Creates the sign-in account on a server, or resets its password if it exists. The demo seed refuses to run in production.
//   docker compose exec -e ADMIN_EMAIL=you@kyvag.com -e ADMIN_PASSWORD='…' backend node dist/create-admin.js
import { hashPassword } from "./auth/crypto.js";
import { createUser, getUserByEmail, updateUser } from "./auth/users.js";
import { ensureDefaultStages, prisma } from "./db.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "";
const name = process.env.ADMIN_NAME?.trim() || "Admin";

if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Set ADMIN_EMAIL to the email to sign in with.");
if (password.length < 8) throw new Error("Set ADMIN_PASSWORD to at least 8 characters.");

await ensureDefaultStages();
const passwordHash = await hashPassword(password);
const existing = await getUserByEmail(email);
if (existing) {
  // Also unlocks the account and signs it out everywhere
  await updateUser(existing.id, { passwordHash, failedLogins: 0, lockedUntil: null, disabled: false, sessions: { deleteMany: {} } });
  console.log(`Password reset for ${email}`);
} else {
  await createUser({ email, name, role: "admin", passwordHash });
  console.log(`Created ${email}`);
}
await prisma.$disconnect();
