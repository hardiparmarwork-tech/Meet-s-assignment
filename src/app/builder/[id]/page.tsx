import { requireAuth } from "@/lib/server/guard";
import { Processing } from "@/components/Builder";

export const metadata = { title: "Processing" };

export default async function ProcessingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAuth(`/builder/${id}`);
  return (
    <main id="content" className="page narrow">
      <h1>Processing</h1>
      <Processing id={id} />
    </main>
  );
}
