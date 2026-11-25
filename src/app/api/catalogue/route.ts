import { NextResponse } from "next/server";
import { guardApi } from "@/lib/server/guard";
import { verifyCatalogue } from "@/lib/capabilities";

export async function POST(req: Request) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const report = await verifyCatalogue();
  return NextResponse.json({ checkedAt: report.checkedAt });
}
