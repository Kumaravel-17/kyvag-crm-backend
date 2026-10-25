import { randomUUID } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import { config } from "../config.js";
import { db, type SessionRow, type UserRow } from "../db.js";
import { hashToken, newToken } from "./crypto.js";
import { getUserById } from "./users.js";

export const SESSION_COOKIE = "kyvag_session";

const HOUR = 60 * 60_000;
// "Keep me signed in" gives a rolling 30-day cookie; otherwise the cookie ends with the browser and the server drops it after 12 idle hours
const ttl = (persistent: boolean) => (persistent ? 30 * 24 * HOUR : 12 * HOUR);
// Avoids a database write on every request just to bump the expiry
const TOUCH_EVERY = 60_000;

const cookieBase: CookieOptions = { httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/" };

function setCookie(res: Response, token: string, persistent: boolean) {
  res.cookie(SESSION_COOKIE, token, persistent ? { ...cookieBase, maxAge: ttl(true) } : cookieBase);
}

export const clearSessionCookie = (res: Response) => res.clearCookie(SESSION_COOKIE, cookieBase);

export function startSession(req: Request, res: Response, userId: string, persistent: boolean) {
  const token = newToken();
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, persistent, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), hashToken(token), userId, persistent ? 1 : 0, now, now, now + ttl(persistent), req.ip ?? null, req.get("user-agent")?.slice(0, 300) ?? null);
  setCookie(res, token, persistent);
}

/** Resolves the session cookie to a live session and its user, sliding the expiry forward */
export function resumeSession(req: Request, res: Response): { session: SessionRow; user: UserRow } | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) return null;

  const session = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(hashToken(token)) as SessionRow | undefined;
  if (!session) return null;

  const now = Date.now();
  const user = getUserById(session.user_id);
  if (session.expires_at <= now || !user || user.disabled) {
    endSession(session.id);
    return null;
  }

  if (now - session.last_seen_at > TOUCH_EVERY) {
    const persistent = session.persistent === 1;
    db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(now, now + ttl(persistent), session.id);
    if (persistent) setCookie(res, token, true);
  }
  return { session, user };
}

export const endSession = (id: string) => db.prepare("DELETE FROM sessions WHERE id = ?").run(id);

/** Signs the user out everywhere, optionally keeping the session making the request */
export const endUserSessions = (userId: string, exceptId?: string) =>
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?").run(userId, exceptId ?? null);

export const listUserSessions = (userId: string) =>
  db.prepare("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC").all(userId, Date.now()) as SessionRow[];
