import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { openDb, upsertPerson, addAuthor } from "../src/db.js";

function makeServer(t) {
  const db = openDb();
  upsertPerson(db, {
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "대한민국 임시정부 주석",
  });
  addAuthor(db, { name: "홍역사", credential: "사학과 교수", wallet: "0xABC" });
  const app = createApp(db, { rpcUrl: "http://127.0.0.1:8545", contract: "0x0" });
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, db };
}

test("목록 페이지가 인물을 보여준다", async (t) => {
  const { base } = makeServer(t);
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /김구/);
});

test("검색 쿼리가 필터링한다 (htmx 부분 렌더 포함)", async (t) => {
  const { base } = makeServer(t);
  const full = await (await fetch(base + "/?q=없는사람")).text();
  assert.doesNotMatch(full, /김구/);
  const partial = await (
    await fetch(base + "/?q=김", { headers: { "HX-Request": "true" } })
  ).text();
  assert.match(partial, /김구/);
  assert.doesNotMatch(partial, /<html/);
});

test("상세 페이지가 요약과 검증 버튼을 보여준다", async (t) => {
  const { base } = makeServer(t);
  const html = await (await fetch(base + "/persons/kim-gu")).text();
  assert.match(html, /임시정부 주석/);
  assert.match(html, /verify-btn/);
});

test("없는 인물은 404", async (t) => {
  const { base } = makeServer(t);
  assert.equal((await fetch(base + "/persons/nope")).status, 404);
});

test("작성자 목록이 실명과 자격을 공개한다", async (t) => {
  const { base } = makeServer(t);
  const html = await (await fetch(base + "/authors")).text();
  assert.match(html, /홍역사/);
  assert.match(html, /사학과 교수/);
});

import { canonicalize } from "../public/canonical.js";
import { ethers } from "ethers";
import { listVersions, latestAnchored } from "../src/db.js";

test("폼 제출이 person을 저장하고 올바른 해시의 draft를 만든다", async (t) => {
  const { base, db } = makeServer(t);
  const body = new URLSearchParams({
    slug: "an-junggeun", name: "안중근", category: "independence",
    birth: "1879", death: "1910", summary: "하얼빈 의거",
  });
  const res = await fetch(base + "/persons", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body, redirect: "manual",
  });
  assert.equal(res.status, 302);
  const versions = listVersions(db, "an-junggeun");
  assert.equal(versions.length, 1);
  assert.equal(versions[0].status, "draft");
  const content = JSON.parse(versions[0].content_json);
  assert.equal(content.name, "안중근");
  const expected = ethers.keccak256(ethers.toUtf8Bytes(canonicalize(content)));
  assert.equal(versions[0].content_hash, expected);
  assert.match(res.headers.get("location"), /\/versions\/\d+\/anchor$/);
});

test("anchored 콜백이 상태를 전이시키고, 잘못된 txHash는 거부한다", async (t) => {
  const { base, db } = makeServer(t);
  const body = new URLSearchParams({
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "대한민국 임시정부 주석",
  });
  await fetch(base + "/persons", { method: "POST", body, redirect: "manual" });
  const [draft] = listVersions(db, "kim-gu");

  const bad = await fetch(`${base}/versions/${draft.id}/anchored`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: "nope", wallet: "0xABC" }),
  });
  assert.equal(bad.status, 400);

  const ok = await fetch(`${base}/versions/${draft.id}/anchored`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: "0x" + "ab".repeat(32), wallet: "0xABC" }),
  });
  assert.equal(ok.status, 200);
  assert.equal(latestAnchored(db, "kim-gu").content_hash, draft.content_hash);
});

test("필수 필드가 빠지면 400", async (t) => {
  const { base } = makeServer(t);
  const res = await fetch(base + "/persons", {
    method: "POST",
    body: new URLSearchParams({ slug: "", name: "", category: "independence" }),
  });
  assert.equal(res.status, 400);
});

import { createDraft, markAnchored as dbMarkAnchored } from "../src/db.js";

test("latest.json은 앵커된 최신 버전만 준다", async (t) => {
  const { base, db } = makeServer(t);
  assert.equal((await fetch(base + "/persons/kim-gu/latest.json")).status, 404);
  const id = createDraft(db, {
    personSlug: "kim-gu",
    contentJson: '{"name":"김구"}',
    contentHash: "0x" + "cd".repeat(32),
  });
  dbMarkAnchored(db, { versionId: id, txHash: "0x" + "ef".repeat(32), wallet: "0xABC" });
  const res = await fetch(base + "/persons/kim-gu/latest.json");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.content.name, "김구");
  assert.equal(body.contentHash, "0x" + "cd".repeat(32));
  assert.equal(body.txHash, "0x" + "ef".repeat(32));
});
