import { DatabaseSync } from "node:sqlite";

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
`;

export function openDb(path = ":memory:") {
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
