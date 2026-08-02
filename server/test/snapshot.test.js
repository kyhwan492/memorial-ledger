import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDb, upsertPerson, addSource, addAuthor, createDraft, markAnchored,
  addChangeRequest, escalateRequest, addReview, getChangeRequest, getPerson, listVersions,
} from "../src/db.js";
import { listRequests, getRequestDetail } from "../mcp/handlers.js";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "snapshot.js");

function seedFullDb(path) {
  const db = openDb(path);
  upsertPerson(db, { slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "임시정부 주석" });
  addSource(db, { personSlug: "kim-gu", label: "공훈전자사료관", url: "https://e-gonghun.mpva.go.kr/" });
  addAuthor(db, { name: "홍역사", credential: "사학과 교수", wallet: "0xABC" });
  const vid = createDraft(db, { personSlug: "kim-gu", contentJson: '{"name":"김구"}', contentHash: "0x" + "ab".repeat(32) });
  markAnchored(db, { versionId: vid, txHash: "0x" + "cd".repeat(32), wallet: "0xABC" });
  const rid = addChangeRequest(db, { personSlug: "kim-gu", requesterName: "박제보",
    contact: "secret@example.com", field: "summary", proposed: "x", evidence: "y" });
  escalateRequest(db, rid);
  addReview(db, { requestId: rid, reviewerName: "김검토", verdict: "approve", comment: "확인" });
  return { db, rid };
}

test("export는 연락처를 제외하고, import로 왕복 복원된다", (t) => {
  const work = mkdtempSync(join(tmpdir(), "snap-"));
  const srcDb = join(work, "src.db");
  const dstDb = join(work, "dst.db");
  const snapDir = join(work, "snapshot");
  seedFullDb(srcDb);

  execFileSync(process.execPath, [SCRIPT, "export", snapDir], { env: { ...process.env, DB_PATH: srcDb } });

  // 연락처가 스냅샷 어디에도 없다
  const requestsJson = readFileSync(join(snapDir, "change_requests.json"), "utf8");
  assert.doesNotMatch(requestsJson, /secret@example\.com/);
  assert.doesNotMatch(requestsJson, /requester_contact/);
  assert.match(requestsJson, /박제보/);

  execFileSync(process.execPath, [SCRIPT, "import", snapDir], { env: { ...process.env, DB_PATH: dstDb } });

  const db2 = openDb(dstDb);
  assert.equal(getPerson(db2, "kim-gu").name, "김구");
  assert.equal(listVersions(db2, "kim-gu")[0].content_hash, "0x" + "ab".repeat(32));
  const restored = getChangeRequest(db2, 1);
  assert.equal(restored.status, "in_review");
  assert.equal(restored.requester_contact, ""); // 연락처는 설계상 복원 불가
  assert.equal(db2.prepare("SELECT COUNT(*) AS n FROM reviews").get().n, 1);
});

test("MCP 읽기 경로는 연락처를 반환하지 않는다", () => {
  const { db, rid } = seedFullDb(":memory:");
  assert.equal(listRequests(db, {})[0].requester_contact, undefined);
  assert.equal(getRequestDetail(db, rid).request.requester_contact, undefined);
});
