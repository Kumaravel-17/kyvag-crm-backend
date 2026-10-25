import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// ---- Opaque tokens (sessions, reset links) ----

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// ---- Passwords ----

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

const scryptAsync = (password: string, salt: Buffer, keyLen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key))));

/** Stored as scrypt$N$r$p$salt$hash so the cost can be raised later without breaking existing hashes */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LEN, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

let dummyHash: Promise<string> | undefined;

/** A missing hash still costs one scrypt run, so response time doesn't reveal whether an email exists */
export async function verifyPassword(password: string, stored: string | null) {
  const target = stored ?? (await (dummyHash ??= hashPassword(randomBytes(16).toString("hex"))));
  const [algo, n, r, p, salt, hash] = target.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return stored !== null && timingSafeEqual(key, expected);
}
