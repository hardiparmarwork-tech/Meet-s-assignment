import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/400-italic.css";
import "@fontsource/eb-garamond/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Live Research Paper", template: "%s · Live Research Paper" }, description: "Research publications with traceable later observations." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#content">Skip to content</a>
        <nav className="site-nav" aria-label="Main">
          <Link href="/" className="brand">Live Research Paper</Link>
          <div><Link href="/archive">Archive</Link><Link href="/sources">Data sources</Link><Link href="/dashboard">Dashboard</Link><Link href="/builder">New paper</Link></div>
        </nav>
        {children}
      </body>
    </html>
  );
}
