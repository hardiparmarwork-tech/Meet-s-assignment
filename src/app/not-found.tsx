import Link from "next/link";
export default function NotFound() {
  return <main id="content" className="page narrow"><h1>Not found</h1><p>This page does not exist or is not public. <Link href="/archive">Browse the archive</Link>.</p></main>;
}
