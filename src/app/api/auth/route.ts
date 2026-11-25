import { NextResponse } from "next/server";
import { checkPassword, COOKIE, createSession, recordFailure, sameOrigin, SESSION_SECONDS, throttled } from "@/lib/auth";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  if (throttled()) return NextResponse.json({ error: "Too many failed attempts. Try again in a few minutes." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!checkPassword(String(body.password ?? ""))) {
    recordFailure();
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  res.cookies.set(COOKIE, createSession(), { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: SESSION_SECONDS });
  return res;
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE);
  return res;
}
