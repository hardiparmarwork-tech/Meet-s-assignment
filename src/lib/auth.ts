import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./db";

export const COOKIE = "lrp_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

/** Reads a secret file, creating it once with a random value. */
function secretFile(name: string, bytes: number): string {
  const file = path.join(dataDir(), name);
  if (!existsSync(file)) {
    try { writeFileSync(file, randomBytes(bytes).toString("base64url"), { flag: "wx", mode: 0o600 }); } catch { /* created concurrently */ }
  }
  return readFileSync(file, "utf8").trim();
}

export const adminPassword = () => process.env.ADMIN_PASSWORD || secretFile("admin-password.txt", 12);

const equal = (a: string, b: string) => {
  const x = createHmac("sha256", "cmp").update(a).digest(), y = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(x, y);
};
export const checkPassword = (given: string) => equal(given, adminPassword());

const sign = (expires: string) => createHmac("sha256", secretFile("session-secret", 32) + adminPassword()).update(expires).digest("base64url");

export function createSession(at = Date.now()): string {
  const expires = String(at + SESSION_SECONDS * 1000);
  return `${expires}.${sign(expires)}`;
}
export function validSession(token: string | undefined, at = Date.now()): boolean {
  const [expires, mac] = (token ?? "").split(".");
  return !!expires && !!mac && Number(expires) > at && equal(mac, sign(expires));
}

/* Simple in-memory throttle on failed sign-ins. */
const failures: number[] = [];
export function throttled(at = Date.now()): boolean {
  while (failures.length && at - failures[0] > 10 * 60_000) failures.shift();
  return failures.length >= 10;
}
export const recordFailure = () => void failures.push(Date.now());

/** Rejects cross-site state-changing requests. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
}
