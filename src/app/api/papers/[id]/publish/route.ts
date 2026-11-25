import { NextResponse } from "next/server";
import { fail, guardApi } from "@/lib/server/guard";
import { publish } from "@/lib/publish";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  try {
    return NextResponse.json(publish((await params).id));
  } catch (e) {
    return fail(e, 409);
  }
}
