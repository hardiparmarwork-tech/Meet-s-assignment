"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** A button that calls a management API, with optional confirmation and a visible result. */
export function ActionButton({ url, method = "POST", body, confirm: question, children, result }: {
  url: string; method?: string; body?: unknown; confirm?: string; children: React.ReactNode; result?: "refresh" | "none";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <span>
      <button type="button" disabled={busy} onClick={async () => {
        if (question && !window.confirm(question)) return;
        setBusy(true);
        setMessage("");
        try {
          const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error);
          if (result === "refresh") setMessage(`${json.succeeded}/${json.requested} retrieved, ${json.changes} change(s)${json.failed ? `, ${json.failed} failed` : ""}`);
          router.refresh();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Working…" : children}</button>
      {message && <small role="status"> {message}</small>}
    </span>
  );
}

export function SignOut() {
  return <button type="button" onClick={async () => { await fetch("/api/auth", { method: "DELETE" }); location.href = "/"; }}>Sign out</button>;
}

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState("");
  return (
    <form className="login" onSubmit={async (e) => {
      e.preventDefault();
      const password = new FormData(e.currentTarget).get("password");
      const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) location.href = next;
      else setError((await res.json()).error);
    }}>
      <label>Author password<input name="password" type="password" autoComplete="current-password" required autoFocus /></label>
      <button className="primary" type="submit">Sign in</button>
      {error && <p className="warn" role="alert">{error}</p>}
    </form>
  );
}
