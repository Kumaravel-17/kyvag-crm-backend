import { prisma, type Prisma, type Role, type User } from "../db.js";
import { hashToken, newToken } from "./crypto.js";

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60_000;
const RESET_LINK_TTL = 60 * 60_000;

/** The only shape of a user that leaves the API (timestamps as epoch ms) */
export const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  title: u.title,
  phone: u.phone,
  role: u.role,
  disabled: u.disabled,
  createdAt: u.createdAt.getTime(),
});

export const getUserById = (id: string) => prisma.user.findUnique({ where: { id } });
export const getUserByEmail = (email: string) => prisma.user.findUnique({ where: { email } });

export const createUser = (input: { email: string; name: string; role: Role; title?: string | null; phone?: string | null; passwordHash?: string | null }) =>
  prisma.user.create({ data: input });

export const updateUser = (id: string, changes: Prisma.UserUpdateInput) => prisma.user.update({ where: { id }, data: changes });

// ---- Lockout after repeated wrong passwords ----

export const isLocked = (u: User, now = Date.now()) => u.lockedUntil !== null && u.lockedUntil.getTime() > now;

export async function recordFailedLogin(u: User) {
  const failed = u.failedLogins + 1;
  await prisma.user.update({
    where: { id: u.id },
    data: failed >= MAX_FAILED_LOGINS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { failedLogins: failed },
  });
}

export const clearFailedLogins = (id: string) => prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });

// ---- One-time password reset links ----

/** Issues a fresh link token; any earlier unused token for the user stops working */
export async function issuePasswordToken(userId: string) {
  const token = newToken();
  await prisma.$transaction([
    prisma.passwordToken.deleteMany({ where: { userId } }),
    prisma.passwordToken.create({ data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + RESET_LINK_TTL) } }),
  ]);
  return token;
}

/** Looks a link token up without using it, for the reset page to check the link */
export async function peekPasswordToken(token: string) {
  const row = await prisma.passwordToken.findUnique({ where: { tokenHash: hashToken(token) } });
  return row && row.expiresAt.getTime() > Date.now() ? row : null;
}

/** Looks a link token up and deletes it, so each link works once even if it's submitted twice at the same moment */
export async function consumePasswordToken(token: string) {
  const row = await peekPasswordToken(token);
  if (!row) return null;
  const { count } = await prisma.passwordToken.deleteMany({ where: { tokenHash: row.tokenHash } });
  return count === 1 ? row : null;
}
