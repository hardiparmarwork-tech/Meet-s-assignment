import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, guardApi } from "@/lib/server/guard";
import { decideParameter, editMetadata } from "@/lib/publish";

const text = z.string().max(5000);
const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("parameter"), parameterId: z.string(), action: z.enum(["approve", "exclude", "reset"]), indicatorId: z.string().optional() }),
  z.object({
    type: z.literal("metadata"),
    patch: z.object({ title: text.optional(), authors: z.array(text).max(100).optional(), abstract: z.string().max(20000).optional(), year: z.number().int().min(1500).max(2200).nullable().optional(), publisher: text.optional(), doi: text.optional(), originalUrl: text.optional() }),
    refreshIntervalHours: z.number().positive().optional(),
  }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = Body.parse(await req.json());
    if (body.type === "parameter") decideParameter(id, body.parameterId, body.action, body.indicatorId);
    else editMetadata(id, body.patch, body.refreshIntervalHours);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
