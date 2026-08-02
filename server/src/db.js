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
  summary TEXT NOT NULL DEFAULT '',
  hunkuk TEXT NOT NULL DEFAULT '',
  workout_affil TEXT NOT NULL DEFAULT '',
  judge_year TEXT NOT NULL DEFAULT '',
  alias TEXT NOT NULL DEFAULT '',
  sex TEXT NOT NULL DEFAULT ''
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
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES change_requests(id),
  reviewer_name TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('approve','reject','needs_work')),
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function openDb(path = ":memory:") {
  // data/ 는 gitignore 대상이라 클론 직후엔 없다 — 열기 전에 만든다
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000;"); // 서버·스크립트가 같은 파일을 쓸 때 락 충돌로 즉사하지 않게
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // 스키마 진화: 기존 DB에 없는 persons 컬럼을 추가한다 (CREATE IF NOT EXISTS는 ALTER하지 않음)
  const existing = new Set(db.prepare("PRAGMA table_info(persons)").all().map((c) => c.name));
  for (const col of ["hunkuk", "workout_affil", "judge_year", "alias", "sex"]) {
    if (!existing.has(col)) db.exec(`ALTER TABLE persons ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  }
  return db;
}

export function upsertPerson(db, { slug, name, category, birth, death, summary,
  hunkuk, workoutAffil, judgeYear, alias, sex }) {
  db.prepare(`
    INSERT INTO persons (slug, name, category, birth, death, summary,
                         hunkuk, workout_affil, judge_year, alias, sex)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, category = excluded.category,
      birth = excluded.birth, death = excluded.death, summary = excluded.summary,
      hunkuk = excluded.hunkuk, workout_affil = excluded.workout_affil,
      judge_year = excluded.judge_year, alias = excluded.alias, sex = excluded.sex
  `).run(slug, name, category, birth ?? "", death ?? "", summary ?? "",
    hunkuk ?? "", workoutAffil ?? "", judgeYear ?? "", alias ?? "", sex ?? "");
}

export function getPerson(db, slug) {
  return db.prepare("SELECT * FROM persons WHERE slug = ?").get(slug);
}

export function listPersons(db, { q, category, hunkuk, workoutAffil, limit, offset } = {}) {
  let sql = "SELECT * FROM persons WHERE 1=1";
  const params = [];
  if (q) { sql += " AND name LIKE ?"; params.push(`%${q}%`); }
  if (category) { sql += " AND category = ?"; params.push(category); }
  if (hunkuk) { sql += " AND hunkuk = ?"; params.push(hunkuk); }
  if (workoutAffil) { sql += " AND workout_affil = ?"; params.push(workoutAffil); }
  sql += " ORDER BY name";
  if (limit) { sql += " LIMIT ? OFFSET ?"; params.push(limit, offset ?? 0); }
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
    WHERE id = ? AND status IN ('open','in_review')
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

export function addReview(db, { requestId, reviewerName, verdict, comment }) {
  const r = db.prepare(
    "INSERT INTO reviews (request_id, reviewer_name, verdict, comment) VALUES (?, ?, ?, ?)"
  ).run(requestId, reviewerName, verdict, comment);
  return Number(r.lastInsertRowid);
}

export function listReviews(db, requestId) {
  return db.prepare("SELECT * FROM reviews WHERE request_id = ? ORDER BY id").all(requestId);
}

// 정족수: 제안자를 제외한 검토자별 '최신' 평결 기준 approve>=2 AND reject==0
export function reviewStatus(db, requestId) {
  const req = db.prepare("SELECT * FROM change_requests WHERE id = ?").get(requestId);
  const latest = db.prepare(`
    SELECT r.reviewer_name, r.verdict FROM reviews r
    JOIN (SELECT reviewer_name, MAX(id) AS mid FROM reviews WHERE request_id = ? GROUP BY reviewer_name) m
      ON r.id = m.mid
  `).all(requestId).filter((r) => !req || r.reviewer_name !== req.requester_name);
  const approvals = latest.filter((r) => r.verdict === "approve").length;
  const rejects = latest.filter((r) => r.verdict === "reject").length;
  return { approvals, rejects, passed: approvals >= 2 && rejects === 0 };
}

export function escalateRequest(db, id) {
  db.prepare("UPDATE change_requests SET status = 'in_review' WHERE id = ? AND status = 'open'").run(id);
}

// 찾기 필터용 distinct 값 (빈 값 제외)
export function listFilterValues(db) {
  const vals = (col) =>
    db.prepare(`SELECT DISTINCT ${col} AS v FROM persons WHERE ${col} != '' ORDER BY v`).all().map((r) => r.v);
  return { hunkuks: vals("hunkuk"), affils: vals("workout_affil") };
}

export function countPersons(db, { q, category, hunkuk, workoutAffil } = {}) {
  let sql = "SELECT COUNT(*) AS n FROM persons WHERE 1=1";
  const params = [];
  if (q) { sql += " AND name LIKE ?"; params.push(`%${q}%`); }
  if (category) { sql += " AND category = ?"; params.push(category); }
  if (hunkuk) { sql += " AND hunkuk = ?"; params.push(hunkuk); }
  if (workoutAffil) { sql += " AND workout_affil = ?"; params.push(workoutAffil); }
  return Number(db.prepare(sql).get(...params).n);
}
