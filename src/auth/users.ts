import { randomUUID } from "node:crypto";
import { db, type Role, type UserRow } from "../db.js";
import { hashToken, newToken } from "./crypto.js";

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60_000;
const RESET_LINK_TTL = 60 * 60_000;

/** The only shape of a user that leaves the API */
export const publicUser = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  title: u.title,
  phone: u.phone,
  role: u.role,
  disabled: u.disabled === 1,
  createdAt: u.created_at,
});

export const getUserById = (id: string) => db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
export const getUserByEmail = (email: string) => db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;

export function createUser(input: { email: string; name: string; role: Role; title?: string | null; phone?: string | null; passwordHash?: string | null }) {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, name, title, phone, role, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.email, input.name, input.title ?? null, input.phone ?? null, input.role, input.passwordHash ?? null, now, now);
  return getUserById(id)!;
}

const UPDATABLE = ["email", "name", "title", "phone", "role", "disabled", "password_hash"] as const;
type UserUpdate = Partial<Pick<UserRow, (typeof UPDATABLE)[number]>>;

export function updateUser(id: string, changes: UserUpdate) {
  const keys = UPDATABLE.filter((k) => changes[k] !== undefined);
  if (keys.length) {
    const sets = keys.map((k) => `${k} = @${k}`).join(", ");
    db.prepare(`UPDATE users SET ${sets}, updated_at = @now WHERE id = @id`).run({ ...changes, id, now: Date.now() });
  }
  return getUserById(id)!;
}

// ---- Lockout after repeated wrong passwords ----

export const isLocked = (u: UserRow, now = Date.now()) => u.locked_until !== null && u.locked_until > now;

export function recordFailedLogin(u: UserRow) {
  const failed = u.failed_logins + 1;
  if (failed >= MAX_FAILED_LOGINS) {
    db.prepare("UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?").run(Date.now() + LOCK_MS, u.id);
  } else {
    db.prepare("UPDATE users SET failed_logins = ? WHERE id = ?").run(failed, u.id);
  }
}

export const clearFailedLogins = (id: string) => db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").run(id);

// ---- One-time password reset links ----

/** Issues a fresh link token; any earlier unused token for the user stops working */
export function issuePasswordToken(userId: string) {
  const token = newToken();
  db.transaction(() => {
    db.prepare("DELETE FROM password_tokens WHERE user_id = ?").run(userId);
    db.prepare("INSERT INTO password_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)").run(
      hashToken(token), userId, "reset", Date.now() + RESET_LINK_TTL,
    );
  })();
  return token;
}

/** Looks a link token up and deletes it, so each link works once */
export function consumePasswordToken(token: string) {
  const row = db.prepare("DELETE FROM password_tokens WHERE token_hash = ? RETURNING user_id, expires_at").get(hashToken(token)) as
    | { user_id: string; expires_at: number }
    | undefined;
  return row && row.expires_at > Date.now() ? row : undefined;
}

export const peekPasswordToken = (token: string) => {
  const row = db.prepare("SELECT user_id, expires_at FROM password_tokens WHERE token_hash = ?").get(hashToken(token)) as
    | { user_id: string; expires_at: number }
    | undefined;
  return row && row.expires_at > Date.now() ? row : undefined;
};
