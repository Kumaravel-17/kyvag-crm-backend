import type { RequestHandler } from "express";
import { hashPassword, verifyPassword } from "../auth/crypto.js";
import { authOf } from "../auth/middleware.js";
import * as s from "../auth/schemas.js";
import { clearSessionCookie, endSession, endUserSessions, startSession } from "../auth/sessions.js";
import {
  clearFailedLogins, consumePasswordToken, getUserByEmail, getUserById, isLocked, issuePasswordToken, peekPasswordToken, publicUser, recordFailedLogin, updateUser,
} from "../auth/users.js";
import { config } from "../config.js";
import { HttpError, parse } from "../http.js";
import { sendMail } from "../mailer.js";

const WRONG_CREDENTIALS = "That email and password don't match. Check them and try again.";
const LOCKED = "Too many wrong passwords. Wait 15 minutes, or reset your password.";
const EXPIRED_LINK = "This link has expired or was already used. Ask for a new one.";

// ---- Sign in / out ----

export const login: RequestHandler = async (req, res) => {
  const { email, password, remember } = parse(s.loginBody, req.body);
  const user = await getUserByEmail(email);
  if (user && isLocked(user)) throw new HttpError(429, LOCKED);

  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok) {
    if (user) await recordFailedLogin(user);
    throw new HttpError(401, WRONG_CREDENTIALS);
  }
  // Only said after a correct password, so it doesn't reveal which emails have accounts
  if (user.disabled) throw new HttpError(403, "This account has been turned off.");
  await clearFailedLogins(user.id);

  // One device at a time: signing in here ends any session on another device
  await endUserSessions(user.id);
  await startSession(req, res, user.id, remember);
  res.json({ user: publicUser(user) });
};

export const logout: RequestHandler = async (req, res) => {
  if (req.auth) await endSession(req.auth.session.id);
  clearSessionCookie(res);
  res.json({ ok: true });
};

// ---- Current user ----

export const getMe: RequestHandler = (req, res) => {
  res.json({ user: publicUser(authOf(req).user) });
};

export const updateMe: RequestHandler = async (req, res) => {
  const { user } = authOf(req);
  const { currentPassword, ...changes } = parse(s.updateProfileBody, req.body);

  if (changes.email && changes.email !== user.email) {
    if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new HttpError(400, "Enter your current password to change your email.");
    }
    if (await getUserByEmail(changes.email)) throw new HttpError(409, "Another account already uses that email.");
  }
  res.json({ user: publicUser(await updateUser(user.id, changes)) });
};

// ---- Passwords ----

export const changePassword: RequestHandler = async (req, res) => {
  const { user, session } = authOf(req);
  const { currentPassword, newPassword } = parse(s.changePasswordBody, req.body);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new HttpError(400, "Your current password isn't right.");
  if (newPassword === currentPassword) throw new HttpError(400, "Choose a password different from your current one.");

  await updateUser(user.id, { passwordHash: await hashPassword(newPassword) });
  // Anyone signed in elsewhere with the old password is signed out; this device stays signed in
  await endUserSessions(user.id, session.id);
  res.json({ ok: true });
};

export const forgotPassword: RequestHandler = async (req, res) => {
  const { email } = parse(s.forgotPasswordBody, req.body);
  const user = await getUserByEmail(email);
  if (user && !user.disabled) {
    const token = await issuePasswordToken(user.id);
    await sendMail({
      to: user.email,
      subject: "Reset your Kyvag CRM password",
      text: `Hi ${user.name},\n\nOpen this link to choose a new password. It works once and expires in 1 hour.\n\n${config.appUrl}/reset-password?token=${token}\n\nIf you didn't ask for this, you can ignore this email.`,
    });
  }
  // Same answer either way, so this can't be used to find out which emails have accounts
  res.json({ ok: true, message: "If that email has an account, we've sent a link to reset the password." });
};

/** Lets the reset page check a link before showing the form */
export const checkResetLink: RequestHandler = async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const row = token ? await peekPasswordToken(token) : null;
  const user = row && (await getUserById(row.userId));
  if (!row || !user || user.disabled) throw new HttpError(400, EXPIRED_LINK);
  res.json({ email: user.email, name: user.name });
};

/** Sets a password from a reset link */
export const resetPassword: RequestHandler = async (req, res) => {
  const { token, newPassword } = parse(s.resetPasswordBody, req.body);
  const row = await consumePasswordToken(token);
  const user = row && (await getUserById(row.userId));
  if (!row || !user || user.disabled) throw new HttpError(400, EXPIRED_LINK);

  await updateUser(user.id, { passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null });
  await endUserSessions(user.id);
  res.json({ ok: true, email: user.email });
};
