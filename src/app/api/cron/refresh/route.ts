import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { refreshDue } from "@/lib/refresh";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json(await refreshDue("cron"));
}
