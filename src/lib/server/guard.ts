import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { COOKIE, sameOrigin, validSession } from "../auth";

export async function isAuthed(): Promise<boolean> {
  return validSession((await cookies()).get(COOKIE)?.value);
}

export async function requireAuth(next: string): Promise<void> {
  if (!(await isAuthed())) redirect(`/login?next=${encodeURIComponent(next)}`);
}

/** Returns an error response, or null when the request may proceed. */
export async function guardApi(req: Request): Promise<NextResponse | null> {
  if (!(await isAuthed())) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (req.method !== "GET" && !sameOrigin(req)) return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  return null;
}

export const fail = (e: unknown, status = 400) => NextResponse.json({ error: (e as Error).message }, { status });
