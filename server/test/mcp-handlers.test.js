import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { openDb, upsertPerson, createDraft, markAnchored, addChangeRequest, escalateRequest } from "../src/db.js";
import { canonicalize } from "../public/canonical.js";
import { searchPersons, getPersonDetail, verifyRecord, submitChangeRequest, listRequests, getRequestDetail, submitReview } from "../mcp/handlers.js";

function seeded() {
  const db = openDb();
  upsertPerson(db, { slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "임시정부 주석" });
  return db;
}

test("searchPersons/getPersonDetail", () => {
  const db = seeded();
  assert.equal(searchPersons(db, { q: "김" }).length, 1);
  assert.equal(getPersonDetail(db, "kim-gu").person.name, "김구");
  assert.equal(getPersonDetail(db, "nope"), null);
});

test("submitChangeRequest는 필수값을 검증한다", () => {
  const db = seeded();
  assert.throws(() => submitChangeRequest(db, { personSlug: "kim-gu", requesterName: "박제보" }));
  const { id } = submitChangeRequest(db, {
    personSlug: "kim-gu", requesterName: "박제보", contact: "bo@ex.com",
    field: "summary", proposed: "수정안", evidence: "https://e-gonghun.mpva.go.kr/",
  });
  assert.equal(listRequests(db, { status: "open" })[0].id, id);
});

test("verifyRecord가 가짜 체인과 대조한다", async () => {
  const db = seeded();
  const content = { slug: "kim-gu", name: "김구" };
  const canonical = canonicalize(content);
  const hash = ethers.keccak256(ethers.toUtf8Bytes(canonical));
  const vid = createDraft(db, { personSlug: "kim-gu", contentJson: canonical, contentHash: hash });
  markAnchored(db, { versionId: vid, txHash: "0x" + "ab".repeat(32), wallet: "0xW" });
  const fakeChain = { latest: async () => [hash, "0xAUTHOR", 0n], getVersion: async () => [hash, "0xAUTHOR", 0n] };
  const r = await verifyRecord(db, { contract: fakeChain }, { slug: "kim-gu" });
  assert.equal(r.verified, true);
  const bad = { latest: async () => ["0x" + "00".repeat(32), "0xAUTHOR", 0n] };
  const r2 = await verifyRecord(db, { contract: bad }, { slug: "kim-gu" });
  assert.equal(r2.verified, false);
});

test("getRequestDetail과 submitReview", () => {
  const db = seeded();
  const rid = addChangeRequest(db, { personSlug: "kim-gu", requesterName: "박제보",
    contact: "b@e.c", field: "summary", proposed: "x", evidence: "y" });
  assert.throws(() => submitReview(db, { requestId: rid, reviewerName: "홍역사",
    verdict: "approve", comment: "ok" })); // open 상태 — 거부
  escalateRequest(db, rid);
  assert.throws(() => submitReview(db, { requestId: rid, reviewerName: "홍역사", verdict: "approve" })); // comment 누락
  assert.throws(() => submitReview(db, { requestId: rid, reviewerName: "홍역사",
    verdict: "maybe", comment: "?" })); // verdict 화이트리스트
  submitReview(db, { requestId: rid, reviewerName: "홍역사", verdict: "approve", comment: "사료 일치" });
  submitReview(db, { requestId: rid, reviewerName: "김검토", verdict: "approve", comment: "확인" });
  const d = getRequestDetail(db, rid);
  assert.equal(d.reviews.length, 2);
  assert.equal(d.quorum.passed, true);
  assert.equal(getRequestDetail(db, 9999), null);
});
