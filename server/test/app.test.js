import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { openDb, upsertPerson, addAuthor } from "../src/db.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeServer(t, config = {}) {
  const db = openDb();
  upsertPerson(db, {
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "대한민국 임시정부 주석",
  });
  addAuthor(db, { name: "홍역사", credential: "사학과 교수", wallet: "0xABC" });
  const app = createApp(db, { rpcUrl: "http://127.0.0.1:8545", contract: "0x0", ...config });
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
    birth: "1876", death: "1949", summary: "대한민국 임시정부 주석", note: "테스트 수정",
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

import { createDraft, markAnchored as dbMarkAnchored, listChangeRequests } from "../src/db.js";

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

test("소개 페이지가 검증 원리를 설명한다", async (t) => {
  const { base } = makeServer(t);
  const html = await (await fetch(base + "/about")).text();
  assert.match(html, /불변성/);
  assert.match(html, /진실성/);
});

test("인물 페이지에 후원 섹션이 있다", async (t) => {
  const { base } = makeServer(t);
  const html = await (await fetch(base + "/persons/kim-gu")).text();
  assert.match(html, /donate-section/);
});

test("note가 content에 포함되어 해시에 반영된다", async (t) => {
  const { base, db } = makeServer(t);
  const body = new URLSearchParams({
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "수정된 요약", note: "출생 연도 출처 보강",
  });
  await fetch(base + "/persons", { method: "POST", body, redirect: "manual" });
  const [draft] = listVersions(db, "kim-gu");
  assert.equal(JSON.parse(draft.content_json).note, "출생 연도 출처 보강");
});

test("버전 diff가 바뀐 필드를 보여준다", async (t) => {
  const { base, db } = makeServer(t);
  const mk = (summary, note) => fetch(base + "/persons", {
    method: "POST",
    body: new URLSearchParams({ slug: "kim-gu", name: "김구", category: "independence",
      birth: "1876", death: "1949", summary, note }),
    redirect: "manual",
  });
  await mk("요약 v1", "최초 등록");
  await mk("요약 v2", "오탈자 수정");
  const [v2] = listVersions(db, "kim-gu");
  const html = await (await fetch(`${base}/versions/${v2.id}/diff`)).text();
  assert.match(html, /요약 v1/);
  assert.match(html, /요약 v2/);
  assert.match(html, /오탈자 수정/);
});

test("versions/:id.json이 chainIndex를 준다", async (t) => {
  const { base, db } = makeServer(t);
  const id = createDraft(db, { personSlug: "kim-gu", contentJson: '{"a":1}', contentHash: "0x" + "11".repeat(32) });
  assert.equal((await fetch(`${base}/versions/${id}.json`)).status, 404); // draft는 404
  dbMarkAnchored(db, { versionId: id, txHash: "0x" + "22".repeat(32), wallet: "0xW" });
  const body = await (await fetch(`${base}/versions/${id}.json`)).json();
  assert.equal(body.chainIndex, 0);
  assert.equal(body.content.a, 1);
});

test("수정 요청 제출·공개 목록·처리", async (t) => {
  const { base, db } = makeServer(t);
  const bad = await fetch(base + "/requests", { method: "POST",
    body: new URLSearchParams({ person: "kim-gu", requesterName: "박제보" }) });
  assert.equal(bad.status, 400);
  const ok = await fetch(base + "/requests", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ person: "kim-gu", requesterName: "박제보", contact: "bo@ex.com",
      field: "summary", proposed: "더 정확한 요약", evidence: "https://e-gonghun.mpva.go.kr/" }) });
  assert.equal(ok.status, 302);
  const list = await (await fetch(base + "/requests?status=open")).text();
  assert.match(list, /박제보/);
  const [req0] = listChangeRequests(db, {});
  const noNote = await fetch(`${base}/requests/${req0.id}/resolve`, { method: "POST",
    body: new URLSearchParams({ status: "rejected", resolverName: "홍역사" }) });
  assert.equal(noNote.status, 400); // 반려엔 사유 필수
  await fetch(`${base}/requests/${req0.id}/resolve`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ status: "rejected", resolverName: "홍역사", note: "근거 불충분" }) });
  const detail = await (await fetch(`${base}/requests/${req0.id}`)).text();
  assert.match(detail, /근거 불충분/);
});

test("기존 인물 수정에 note 없으면 400, 잘못된 반영 버전은 400, 재처리는 409", async (t) => {
  const { base, db } = makeServer(t);
  const noNote = await fetch(base + "/persons", { method: "POST",
    body: new URLSearchParams({ slug: "kim-gu", name: "김구", category: "independence" }) });
  assert.equal(noNote.status, 400);
  await fetch(base + "/requests", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ person: "kim-gu", requesterName: "박제보", contact: "b@e.c",
      field: "summary", proposed: "x", evidence: "y" }) });
  const [r] = listChangeRequests(db, {});
  const badVid = await fetch(`${base}/requests/${r.id}/resolve`, { method: "POST",
    body: new URLSearchParams({ status: "accepted", resolverName: "홍역사", versionId: "9999" }) });
  assert.equal(badVid.status, 400);
  await fetch(`${base}/requests/${r.id}/resolve`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ status: "rejected", resolverName: "홍역사", note: "근거 불충분" }) });
  const again = await fetch(`${base}/requests/${r.id}/resolve`, { method: "POST",
    body: new URLSearchParams({ status: "accepted", resolverName: "홍역사" }) });
  assert.equal(again.status, 409);
});

test("심사 전환과 리뷰 제출, 정족수 강제", async (t) => {
  const { base, db } = makeServer(t);
  await fetch(base + "/requests", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ person: "kim-gu", requesterName: "박제보", contact: "b@e.c",
      field: "summary", proposed: "x", evidence: "y" }) });
  const [r] = listChangeRequests(db, {});
  // open 상태에서 리뷰 제출은 409
  const early = await fetch(`${base}/requests/${r.id}/reviews`, { method: "POST",
    body: new URLSearchParams({ reviewerName: "홍역사", verdict: "approve", comment: "ok" }) });
  assert.equal(early.status, 409);
  // 심사 전환
  await fetch(`${base}/requests/${r.id}/escalate`, { method: "POST", redirect: "manual" });
  // 필수값 누락 400
  const bad = await fetch(`${base}/requests/${r.id}/reviews`, { method: "POST",
    body: new URLSearchParams({ reviewerName: "홍역사", verdict: "approve" }) });
  assert.equal(bad.status, 400);
  // 정족수 미충족 상태에서 수용 시도 → 403
  await fetch(`${base}/requests/${r.id}/reviews`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ reviewerName: "홍역사", verdict: "approve", comment: "사료 일치" }) });
  const deny = await fetch(`${base}/requests/${r.id}/resolve`, { method: "POST",
    body: new URLSearchParams({ status: "accepted", resolverName: "홍역사" }) });
  assert.equal(deny.status, 403);
  // 두 번째 승인 후 수용 성공
  await fetch(`${base}/requests/${r.id}/reviews`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ reviewerName: "김검토", verdict: "approve", comment: "근거 확인" }) });
  const ok = await fetch(`${base}/requests/${r.id}/resolve`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ status: "accepted", resolverName: "홍역사" }) });
  assert.equal(ok.status, 302);
  const html = await (await fetch(`${base}/requests/${r.id}`)).text();
  assert.match(html, /사료 일치/);
  assert.match(html, /김검토/);
});

test("심사 전환은 open에서만, 요청 목록에 in_review 필터", async (t) => {
  const { base, db } = makeServer(t);
  await fetch(base + "/requests", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ person: "kim-gu", requesterName: "박제보", contact: "b@e.c",
      field: "birth", proposed: "z", evidence: "w" }) });
  const [r] = listChangeRequests(db, {});
  await fetch(`${base}/requests/${r.id}/escalate`, { method: "POST", redirect: "manual" });
  const again = await fetch(`${base}/requests/${r.id}/escalate`, { method: "POST" });
  assert.equal(again.status, 409);
  const list = await (await fetch(base + "/requests?status=in_review")).text();
  assert.match(list, /박제보/);
});

test("donate-section이 설정된 토큰 목록을 노출한다", async (t) => {
  const db = openDb();
  upsertPerson(db, { slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "x" });
  const app = createApp(db, { rpcUrl: "http://127.0.0.1:8545", contract: "0x0",
    tokens: [{ symbol: "TKRW", address: "0x" + "aa".repeat(20), decimals: 18 }] });
  const server = app.listen(0);
  t.after(() => server.close());
  const html = await (await fetch(`http://127.0.0.1:${server.address().port}/persons/kim-gu`)).text();
  assert.match(html, /TKRW/);
});

test("훈격·운동계열 필터가 동작한다", async (t) => {
  const { base, db } = makeServer(t);
  upsertPerson(db, { slug: "an-junggeun", name: "안중근", category: "independence",
    birth: "1879", death: "1910", summary: "z", hunkuk: "대한민국장", workoutAffil: "의열투쟁" });
  const html = await (await fetch(base + "/?hunkuk=" + encodeURIComponent("대한민국장"))).text();
  assert.match(html, /안중근/);
  assert.doesNotMatch(html, /김구<\/a>/);
  const partial = await (await fetch(base + "/?workoutAffil=" + encodeURIComponent("의열투쟁"),
    { headers: { "HX-Request": "true" } })).text();
  assert.match(partial, /안중근/);
});

test("상세 페이지가 확장 필드를 값이 있을 때만 보여준다", async (t) => {
  const { base, db } = makeServer(t);
  upsertPerson(db, { slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "임시정부 주석",
    hunkuk: "대한민국장", workoutAffil: "임시정부", judgeYear: "1962", alias: "백범" });
  const html = await (await fetch(base + "/persons/kim-gu")).text();
  assert.match(html, /대한민국장/);
  assert.match(html, /백범/);
  const other = await (await fetch(base + "/persons/kim-gu")).text(); // 값 없는 sex는 미표시
  assert.doesNotMatch(other, /성별/);
});

test("확장 필드가 정본 content에 값이 있을 때만 포함된다", async (t) => {
  const { base, db } = makeServer(t);
  await fetch(base + "/persons", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ slug: "kim-gu", name: "김구", category: "independence",
      birth: "1876", death: "1949", summary: "x", note: "필드 보강", hunkuk: "대한민국장" }) });
  const [draft] = listVersions(db, "kim-gu");
  const content = JSON.parse(draft.content_json);
  assert.equal(content.hunkuk, "대한민국장");
  assert.equal("alias" in content, false); // 빈 필드는 생략
});

test("이달의 독립운동가 섹션은 monthly.json이 있고 이번 달 항목이 있을 때만", async (t) => {
  const now = new Date();
  const dir = mkdtempSync(join(tmpdir(), "monthly-"));
  const file = join(dir, "monthly.json");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { base, db } = makeServer(t, { monthlyPath: file });
  assert.doesNotMatch(await (await fetch(base + "/")).text(), /이달의 독립운동가/); // 파일 없음

  writeFileSync(file, JSON.stringify([
    { year: now.getFullYear() - 1, month: now.getMonth() + 1, name: "지난해", mngNo: "1", summary: "s" },
    { year: now.getFullYear(), month: now.getMonth() + 1, name: "이달인물", mngNo: "9-777", summary: "이달의 공적" },
  ]));
  const html = await (await fetch(base + "/")).text();
  assert.match(html, /이달의 독립운동가/);
  assert.match(html, /이달인물/);
  assert.doesNotMatch(html, /지난해/);
  assert.doesNotMatch(html, /href="\/persons\/gonghun-9-777"/); // 원장에 없으면 링크 없음

  upsertPerson(db, { slug: "gonghun-9-777", name: "이달인물", category: "independence" });
  assert.match(await (await fetch(base + "/")).text(), /href="\/persons\/gonghun-9-777"/);

  writeFileSync(file, "깨진 json");
  assert.doesNotMatch(await (await fetch(base + "/")).text(), /이달의 독립운동가/);
});

test("목록이 페이지네이션된다 (100행 제한 + 페이저)", async (t) => {
  const { base, db } = makeServer(t);
  for (let i = 0; i < 105; i++) {
    upsertPerson(db, { slug: `p-${String(i).padStart(3, "0")}`, name: `인물${i}`,
      category: "independence", birth: "", death: "", summary: "" });
  }
  const html = await (await fetch(base + "/")).text();
  assert.equal((html.match(/<td><a href="\/persons\//g) || []).length, 100);
  assert.match(html, /2 페이지/);
  const page2 = await (await fetch(base + "/?page=2")).text();
  assert.match(page2, /← 이전/);
});
