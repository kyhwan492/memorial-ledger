import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS persons (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  birth TEXT NOT NULL DEFAULT '',
  death TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  person_slug TEXT NOT NULL REFERENCES persons(slug),
  label TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  credential TEXT NOT NULL,
  wallet TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS record_versions (
  id INTEGER PRIMARY KEY,
  person_slug TEXT NOT NULL REFERENCES persons(slug),
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  tx_hash TEXT,
  wallet TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY,
  person_slug TEXT NOT NULL REFERENCES persons(slug),
  requester_name TEXT NOT NULL,
  requester_contact TEXT NOT NULL,
  field TEXT NOT NULL,
  proposed TEXT NOT NULL,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolver_name TEXT,
  resolution_note TEXT,
  resolved_version_id INTEGER REFERENCES record_versions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
`;

export function openDb(path = ":memory:") {
  // data/ 는 gitignore 대상이라 클론 직후엔 없다 — 열기 전에 만든다
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

export function upsertPerson(db, { slug, name, category, birth, death, summary }) {
  db.prepare(`
    INSERT INTO persons (slug, name, category, birth, death, summary)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, category = excluded.category,
      birth = excluded.birth, death = excluded.death, summary = excluded.summary
  `).run(slug, name, category, birth ?? "", death ?? "", summary ?? "");
}

export function getPerson(db, slug) {
  return db.prepare("SELECT * FROM persons WHERE slug = ?").get(slug);
}

export function listPersons(db, { q, category } = {}) {
  let sql = "SELECT * FROM persons WHERE 1=1";
  const params = [];
  if (q) { sql += " AND name LIKE ?"; params.push(`%${q}%`); }
  if (category) { sql += " AND category = ?"; params.push(category); }
  sql += " ORDER BY name";
  return db.prepare(sql).all(...params);
}

export function addSource(db, { personSlug, label, url }) {
  db.prepare("INSERT INTO sources (person_slug, label, url) VALUES (?, ?, ?)")
    .run(personSlug, label, url ?? "");
}

export function listSources(db, personSlug) {
  return db.prepare("SELECT * FROM sources WHERE person_slug = ? ORDER BY id").all(personSlug);
}

export function createDraft(db, { personSlug, contentJson, contentHash }) {
  const r = db.prepare(
    "INSERT INTO record_versions (person_slug, content_json, content_hash) VALUES (?, ?, ?)"
  ).run(personSlug, contentJson, contentHash);
  return Number(r.lastInsertRowid);
}

export function markAnchored(db, { versionId, txHash, wallet }) {
  db.prepare(
    "UPDATE record_versions SET status = 'anchored', tx_hash = ?, wallet = ? WHERE id = ?"
  ).run(txHash, wallet ?? null, versionId);
}

export function listVersions(db, personSlug) {
  return db.prepare(
    "SELECT * FROM record_versions WHERE person_slug = ? ORDER BY id DESC"
  ).all(personSlug);
}

export function latestAnchored(db, personSlug) {
  return db.prepare(
    "SELECT * FROM record_versions WHERE person_slug = ? AND status = 'anchored' ORDER BY id DESC LIMIT 1"
  ).get(personSlug);
}

export function addAuthor(db, { name, credential, wallet }) {
  const r = db.prepare(
    "INSERT INTO authors (name, credential, wallet) VALUES (?, ?, ?)"
  ).run(name, credential, wallet);
  return Number(r.lastInsertRowid);
}

export function getAuthor(db, id) {
  return db.prepare("SELECT * FROM authors WHERE id = ?").get(id);
}

export function listAuthors(db) {
  return db.prepare("SELECT * FROM authors ORDER BY id").all();
}

export function addChangeRequest(db, { personSlug, requesterName, contact, field, proposed, evidence }) {
  const r = db.prepare(`
    INSERT INTO change_requests (person_slug, requester_name, requester_contact, field, proposed, evidence)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(personSlug, requesterName, contact, field, proposed, evidence);
  return Number(r.lastInsertRowid);
}

export function getChangeRequest(db, id) {
  return db.prepare("SELECT * FROM change_requests WHERE id = ?").get(id);
}

export function listChangeRequests(db, { personSlug, status } = {}) {
  let sql = "SELECT * FROM change_requests WHERE 1=1";
  const params = [];
  if (personSlug) { sql += " AND person_slug = ?"; params.push(personSlug); }
  if (status) { sql += " AND status = ?"; params.push(status); }
  sql += " ORDER BY id DESC";
  return db.prepare(sql).all(...params);
}

export function resolveChangeRequest(db, { id, status, resolverName, note, versionId }) {
  db.prepare(`
    UPDATE change_requests
    SET status = ?, resolver_name = ?, resolution_note = ?, resolved_version_id = ?,
        resolved_at = datetime('now')
    WHERE id = ? AND status = 'open'
  `).run(status, resolverName, note ?? "", versionId ?? null, id);
}

// 앵커된 버전의 체인 인덱스 = 같은 인물에서 자기보다 먼저 앵커된 버전 수
export function chainIndexOf(db, versionId) {
  const v = db.prepare("SELECT * FROM record_versions WHERE id = ?").get(versionId);
  if (!v || v.status !== "anchored") return null;
  const { n } = db.prepare(
    "SELECT COUNT(*) AS n FROM record_versions WHERE person_slug = ? AND status = 'anchored' AND id < ?"
  ).get(v.person_slug, versionId);
  return Number(n);
}
