import Link from "next/link";
import { requireAuth } from "@/lib/server/guard";
import { Uploader } from "@/components/Builder";
import { geminiConfigured } from "@/lib/connectors/gemini";

export const dynamic = "force-dynamic";
export const metadata = { title: "New paper" };

export default async function BuilderPage() {
  await requireAuth("/builder");
  return (
    <main id="content" className="page narrow">
      <h1>Upload a paper</h1>
      <p>Everything else is automatic: extraction, classification, source matching and validation. You then preview and publish.</p>
      <Uploader geminiOn={geminiConfigured()} />
      <p className="small">Drafts are saved. Return to them from the <Link href="/dashboard">dashboard</Link>.</p>
    </main>
  );
}
