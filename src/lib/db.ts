import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type {
  Analysis, HistoryEntry, MetaOverrides, Paper, PaperState, ParsedDocument, PublishedSnapshot,
  SeriesRecord, Settings, Stage,
} from "./types";

export function dataDir(): string {
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data");
  mkdirSync(path.join(dir, "uploads"), { recursive: true });
  return dir;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY, slug TEXT UNIQUE, state TEXT NOT NULL, file_name TEXT NOT NULL, file_kind TEXT NOT NULL,
  file_size INTEGER NOT NULL, file_hash TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, stages TEXT NOT NULL, error TEXT,
  analysis TEXT, overrides TEXT NOT NULL DEFAULT '{}', settings TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS originals (
  paper_id TEXT PRIMARY KEY, doc TEXT NOT NULL, doc_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS originals_immutable BEFORE UPDATE ON originals
BEGIN SELECT RAISE(ABORT, 'original extracted content is immutable'); END;
CREATE TABLE IF NOT EXISTS versions (
  paper_id TEXT NOT NULL, version INTEGER NOT NULL, published_at TEXT NOT NULL, snapshot TEXT NOT NULL,
  PRIMARY KEY (paper_id, version)
);
CREATE TRIGGER IF NOT EXISTS versions_immutable BEFORE UPDATE ON versions
BEGIN SELECT RAISE(ABORT, 'published versions are immutable'); END;
CREATE TABLE IF NOT EXISTS series (key TEXT PRIMARY KEY, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, paper_id TEXT NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL,
  outcome TEXT NOT NULL, parameter_id TEXT, series_key TEXT, period INTEGER, old_value REAL, new_value REAL,
  source_version TEXT, calc_version TEXT, note TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_paper ON history(paper_id, id);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, stored_at TEXT NOT NULL);
`;

type G = typeof globalThis & { __lrpDb?: { dir: string; db: DatabaseSync } };

export function db(): DatabaseSync {
  const g = globalThis as G;
  const dir = dataDir();
  if (g.__lrpDb?.dir === dir) return g.__lrpDb.db;
  const handle = new DatabaseSync(path.join(dir, "lrp.sqlite"));
  handle.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  handle.exec(SCHEMA);
  g.__lrpDb = { dir, db: handle };
  return handle;
}

export function closeDb(): void {
  const g = globalThis as G;
  g.__lrpDb?.db.close();
  g.__lrpDb = undefined;
}

export const now = () => new Date().toISOString();
export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
export const newId = () => randomBytes(9).toString("hex");

type Row = Record<string, unknown>;
const J = <T>(v: unknown): T => JSON.parse(String(v)) as T;

function toPaper(r: Row): Paper {
  return {
    id: String(r.id), slug: (r.slug as string) ?? null, state: r.state as PaperState,
    fileName: String(r.file_name), fileKind: r.file_kind as Paper["fileKind"], fileSize: Number(r.file_size),
    fileHash: String(r.file_hash), isDemo: !!r.is_demo, createdAt: String(r.created_at),
    updatedAt: String(r.updated_at), stages: J<Stage[]>(r.stages), error: (r.error as string) ?? null,
    analysis: r.analysis ? J<Analysis>(r.analysis) : null,
    overrides: J<MetaOverrides>(r.overrides), settings: J<Settings>(r.settings),
  };
}

export function insertPaper(p: Paper): void {
  db().prepare(
    `INSERT INTO papers (id, slug, state, file_name, file_kind, file_size, file_hash, is_demo, created_at, updated_at, stages, error, analysis, overrides, settings)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(p.id, p.slug, p.state, p.fileName, p.fileKind, p.fileSize, p.fileHash, p.isDemo ? 1 : 0,
    p.createdAt, p.updatedAt, JSON.stringify(p.stages), p.error, p.analysis ? JSON.stringify(p.analysis) : null,
    JSON.stringify(p.overrides), JSON.stringify(p.settings));
}

export function savePaper(p: Paper): void {
  p.updatedAt = now();
  db().prepare(
    `UPDATE papers SET slug=?, state=?, updated_at=?, stages=?, error=?, analysis=?, overrides=?, settings=? WHERE id=?`,
  ).run(p.slug, p.state, p.updatedAt, JSON.stringify(p.stages), p.error,
    p.analysis ? JSON.stringify(p.analysis) : null, JSON.stringify(p.overrides), JSON.stringify(p.settings), p.id);
}

export function getPaper(id: string): Paper | null {
  const r = db().prepare("SELECT * FROM papers WHERE id=?").get(id) as Row | undefined;
  return r ? toPaper(r) : null;
}

export function getPaperBySlug(slug: string): Paper | null {
  const r = db().prepare("SELECT * FROM papers WHERE slug=?").get(slug) as Row | undefined;
  return r ? toPaper(r) : null;
}

export function listPapers(): Paper[] {
  return (db().prepare("SELECT * FROM papers ORDER BY updated_at DESC").all() as Row[]).map(toPaper);
}

/* ---------- originals: written once, never updated ---------- */

export function saveUpload(id: string, buf: Buffer): void {
  writeFileSync(path.join(dataDir(), "uploads", id), buf, { flag: "wx" });
}
export function readUpload(id: string): Buffer {
  return readFileSync(path.join(dataDir(), "uploads", id));
}

export function saveOriginal(paperId: string, doc: ParsedDocument): string {
  const text = JSON.stringify(doc);
  const hash = sha256(text);
  db().prepare("INSERT INTO originals (paper_id, doc, doc_hash, created_at) VALUES (?,?,?,?)")
    .run(paperId, text, hash, now());
  return hash;
}
export function getOriginal(paperId: string): { doc: ParsedDocument; hash: string } | null {
  const r = db().prepare("SELECT doc, doc_hash FROM originals WHERE paper_id=?").get(paperId) as Row | undefined;
  return r ? { doc: J<ParsedDocument>(r.doc), hash: String(r.doc_hash) } : null;
}

/** Only drafts that were never published can be deleted. */
export function deleteDraft(id: string): boolean {
  const p = getPaper(id);
  if (!p || p.slug || latestVersion(id)) return false;
  for (const sql of ["DELETE FROM papers WHERE id=?", "DELETE FROM originals WHERE paper_id=?", "DELETE FROM history WHERE paper_id=?"])
    db().prepare(sql).run(id);
  const file = path.join(dataDir(), "uploads", id);
  if (existsSync(file)) rmSync(file);
  return true;
}

/* ---------- published versions ---------- */

export function insertVersion(paperId: string, snapshot: PublishedSnapshot): void {
  db().prepare("INSERT INTO versions (paper_id, version, published_at, snapshot) VALUES (?,?,?,?)")
    .run(paperId, snapshot.version, snapshot.publishedAt, JSON.stringify(snapshot));
}
export function latestVersion(paperId: string): PublishedSnapshot | null {
  const r = db().prepare("SELECT snapshot FROM versions WHERE paper_id=? ORDER BY version DESC LIMIT 1").get(paperId) as Row | undefined;
  return r ? J<PublishedSnapshot>(r.snapshot) : null;
}

/* ---------- source series ---------- */

export function getSeries(key: string): SeriesRecord | null {
  const r = db().prepare("SELECT record FROM series WHERE key=?").get(key) as Row | undefined;
  return r ? J<SeriesRecord>(r.record) : null;
}
export function putSeries(rec: SeriesRecord): void {
  db().prepare("INSERT INTO series (key, record) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET record=excluded.record")
    .run(rec.key, JSON.stringify(rec));
}

/* ---------- history ---------- */

export function addHistory(h: Omit<HistoryEntry, "id">): void {
  db().prepare(
    `INSERT INTO history (paper_id, at, type, outcome, parameter_id, series_key, period, old_value, new_value, source_version, calc_version, note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(h.paperId, h.at, h.type, h.outcome, h.parameterId, h.seriesKey, h.period, h.oldValue, h.newValue,
    h.sourceVersion, h.calcVersion, h.note);
}

function toHistory(r: Row): HistoryEntry {
  return {
    id: Number(r.id), paperId: String(r.paper_id), at: String(r.at), type: r.type as HistoryEntry["type"],
    outcome: r.outcome as HistoryEntry["outcome"], parameterId: r.parameter_id as string | null,
    seriesKey: r.series_key as string | null, period: r.period as number | null,
    oldValue: r.old_value as number | null, newValue: r.new_value as number | null,
    sourceVersion: r.source_version as string | null, calcVersion: r.calc_version as string | null, note: String(r.note),
  };
}
export function listHistory(paperId?: string, limit = 200): HistoryEntry[] {
  const rows = paperId
    ? db().prepare("SELECT * FROM history WHERE paper_id=? ORDER BY id DESC LIMIT ?").all(paperId, limit)
    : db().prepare("SELECT * FROM history ORDER BY id DESC LIMIT ?").all(limit);
  return (rows as Row[]).map(toHistory);
}

/* ---------- small cache ---------- */

export function kvGet<T>(key: string, maxAgeMs: number): T | null {
  const r = db().prepare("SELECT value, stored_at FROM kv WHERE key=?").get(key) as Row | undefined;
  if (!r || Date.now() - Date.parse(String(r.stored_at)) > maxAgeMs) return null;
  return J<T>(r.value);
}
export function kvSet(key: string, value: unknown): void {
  db().prepare("INSERT INTO kv (key, value, stored_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, stored_at=excluded.stored_at")
    .run(key, JSON.stringify(value), now());
}
