import test from "node:test";
import assert from "node:assert/strict";
import {
  openDb, upsertPerson, getPerson, listPersons, addSource, listSources,
  createDraft, markAnchored, listVersions, latestAnchored,
  addAuthor, getAuthor, listAuthors,
} from "../src/db.js";

function seedPerson(db) {
  upsertPerson(db, {
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "대한민국 임시정부 주석",
  });
}

test("person upsert와 조회", () => {
  const db = openDb();
  seedPerson(db);
  assert.equal(getPerson(db, "kim-gu").name, "김구");
  upsertPerson(db, {
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "수정된 요약",
  });
  assert.equal(getPerson(db, "kim-gu").summary, "수정된 요약");
  assert.equal(listPersons(db).length, 1);
});

test("이름 검색과 분류 필터", () => {
  const db = openDb();
  seedPerson(db);
  upsertPerson(db, {
    slug: "test-vet", name: "홍길동", category: "korean_war",
    birth: "1930", death: "", summary: "6·25 참전",
  });
  assert.equal(listPersons(db, { q: "김" }).length, 1);
  assert.equal(listPersons(db, { category: "korean_war" })[0].slug, "test-vet");
});

test("draft 생성 → anchored 전이와 latestAnchored", () => {
  const db = openDb();
  seedPerson(db);
  const v1 = createDraft(db, { personSlug: "kim-gu", contentJson: "{}", contentHash: "0xaa" });
  assert.equal(latestAnchored(db, "kim-gu"), undefined);
  markAnchored(db, { versionId: v1, txHash: "0x".padEnd(66, "1"), wallet: "0xW" });
  assert.equal(latestAnchored(db, "kim-gu").content_hash, "0xaa");
  const v2 = createDraft(db, { personSlug: "kim-gu", contentJson: "{}", contentHash: "0xbb" });
  markAnchored(db, { versionId: v2, txHash: "0x".padEnd(66, "2"), wallet: "0xW" });
  assert.equal(latestAnchored(db, "kim-gu").content_hash, "0xbb");
  assert.equal(listVersions(db, "kim-gu").length, 2);
});

test("sources와 authors", () => {
  const db = openDb();
  seedPerson(db);
  addSource(db, { personSlug: "kim-gu", label: "공훈전자사료관", url: "https://e-gonghun.mpva.go.kr/" });
  assert.equal(listSources(db, "kim-gu").length, 1);
  const id = addAuthor(db, { name: "홍역사", credential: "사학과 교수", wallet: "0xABC" });
  assert.equal(getAuthor(db, id).name, "홍역사");
  assert.equal(listAuthors(db).length, 1);
});
