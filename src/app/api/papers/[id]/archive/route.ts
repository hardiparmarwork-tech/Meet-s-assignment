import { NextResponse } from "next/server";
import { fail, guardApi } from "@/lib/server/guard";
import { setArchived } from "@/lib/publish";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { archived?: boolean };
    setArchived((await params).id, !!body.archived);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
