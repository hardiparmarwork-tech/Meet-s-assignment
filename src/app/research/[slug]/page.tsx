import { notFound } from "next/navigation";
import { getPaperBySlug } from "@/lib/db";
import { publicationView } from "@/lib/view";
import { Publication } from "@/components/Publication";

// Reads stored observations only; visiting a page never triggers source retrieval.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

function load(slug: string) {
  const paper = getPaperBySlug(slug);
  return paper && (paper.state === "published" || paper.state === "archived") ? publicationView(paper, false) : null;
}

export async function generateMetadata({ params }: Props) {
  const view = load((await params).slug);
  return view ? { title: view.metadata.title, description: view.metadata.abstract.slice(0, 200) } : { title: "Not found" };
}

export default async function Research({ params }: Props) {
  const view = load((await params).slug);
  if (!view) notFound();
  return <Publication view={view} />;
}
