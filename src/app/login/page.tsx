import { LoginForm } from "@/components/Actions";
import { adminPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  adminPassword(); // creates the password file on first visit; the value is never rendered
  // Only same-site relative paths, to avoid an open redirect.
  const safe = next && /^\/(?![/\\])/.test(next) ? next : "/builder";
  return (
    <main id="content" className="page narrow">
      <h1>Author sign in</h1>
      <p>Uploads, drafts and management are private. Set <code>ADMIN_PASSWORD</code>, or use the password generated in <code>data/admin-password.txt</code> on the server.</p>
      <LoginForm next={safe} />
    </main>
  );
}
