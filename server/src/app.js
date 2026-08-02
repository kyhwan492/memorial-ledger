import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { canonicalize } from "../public/canonical.js";
import * as q from "./db.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));

export const CATEGORIES = {
  independence: "독립운동가",
  korean_war: "6·25 참전용사",
  cheonan: "천안함",
  yeonpyeong: "연평도",
};

export function createApp(db, config = {}) {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(DIR, "views"));
  app.use(express.static(path.join(DIR, "..", "public")));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  const chain = {
    rpcUrl: config.rpcUrl ?? "http://127.0.0.1:8545",
    contract: config.contract ?? "",
    donations: config.donations ?? "",
  };

  app.get("/", (req, res) => {
    const persons = q.listPersons(db, { q: req.query.q, category: req.query.category });
    if (req.get("HX-Request")) {
      return res.render("partials/person-rows", { persons, CATEGORIES });
    }
    res.render("index", {
      persons, CATEGORIES,
      query: req.query.q ?? "", category: req.query.category ?? "",
    });
  });

  app.get("/persons/:slug/latest.json", (req, res) => {
    const v = q.latestAnchored(db, req.params.slug);
    if (!v) return res.status(404).json({ error: "앵커된 버전이 없습니다" });
    res.json({
      content: JSON.parse(v.content_json),
      contentHash: v.content_hash,
      txHash: v.tx_hash,
    });
  });

  app.get("/persons/:slug", (req, res) => {
    const person = q.getPerson(db, req.params.slug);
    if (!person) return res.status(404).send("인물을 찾을 수 없습니다");
    const versions = q.listVersions(db, person.slug);
    res.render("person", {
      person, CATEGORIES, chain, versions,
      personIdHex: ethers.id(person.slug),
      sources: q.listSources(db, person.slug),
      chainIndexes: Object.fromEntries(versions.map((v) => [v.id, q.chainIndexOf(db, v.id)])),
      openRequests: q.listChangeRequests(db, { personSlug: person.slug, status: "open" }).length,
    });
  });

  app.get("/authors", (req, res) => {
    res.render("authors", { authors: q.listAuthors(db) });
  });

  app.get("/about", (req, res) => {
    res.render("about");
  });

  // ponytail: draft 작성에 서버 로그인 없음 — 진짜 게이트는 온체인 allowlist
  // (미등록 지갑은 anchor 트랜잭션이 revert). 서버 세션 인증은 후속 작업.
  app.get("/persons/:slug/edit", (req, res) => {
    const isNew = req.params.slug === "new";
    const person = isNew ? null : q.getPerson(db, req.params.slug);
    if (!isNew && !person) return res.status(404).send("인물을 찾을 수 없습니다");
    res.render("edit", { person, CATEGORIES });
  });

  app.post("/persons", (req, res) => {
    const { slug, name, category, birth, death, summary, note } = req.body;
    if (!slug || !name || !CATEGORIES[category]) {
      return res.status(400).send("slug, 이름, 분류는 필수입니다");
    }
    // 기존 인물 수정은 변경 사유가 해시에 영구히 남는다 — 서버에서도 강제
    if (q.getPerson(db, slug) && !note) {
      return res.status(400).send("기존 기록 수정에는 변경 사유(note)가 필수입니다");
    }
    q.upsertPerson(db, { slug, name, category, birth, death, summary });
    const content = {
      slug, name, category,
      birth: birth ?? "", death: death ?? "", summary: summary ?? "",
      note: note || "최초 등록",
      sources: q.listSources(db, slug).map((s) => ({ label: s.label, url: s.url })),
    };
    const canonical = canonicalize(content);
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(canonical));
    const versionId = q.createDraft(db, { personSlug: slug, contentJson: canonical, contentHash });
    res.redirect(`/versions/${versionId}/anchor`);
  });

  app.get("/versions/:id.json", (req, res) => {
    const v = db.prepare("SELECT * FROM record_versions WHERE id = ?").get(req.params.id);
    if (!v || v.status !== "anchored") return res.status(404).json({ error: "앵커된 버전이 아닙니다" });
    res.json({
      content: JSON.parse(v.content_json),
      contentHash: v.content_hash,
      txHash: v.tx_hash,
      chainIndex: q.chainIndexOf(db, v.id),
    });
  });

  app.get("/versions/:id/diff", (req, res) => {
    const v = db.prepare("SELECT * FROM record_versions WHERE id = ?").get(req.params.id);
    if (!v) return res.status(404).send("버전을 찾을 수 없습니다");
    const prev = db.prepare(
      "SELECT * FROM record_versions WHERE person_slug = ? AND id < ? ORDER BY id DESC LIMIT 1"
    ).get(v.person_slug, v.id);
    const after = JSON.parse(v.content_json);
    const before = prev ? JSON.parse(prev.content_json) : {};
    const show = (x) => (x === undefined ? "" : typeof x === "string" ? x : JSON.stringify(x));
    const rows = [...new Set([...Object.keys(before), ...Object.keys(after)])].map((key) => ({
      key, before: show(before[key]), after: show(after[key]),
      changed: show(before[key]) !== show(after[key]),
    }));
    res.render("diff", { v, prev, rows, note: after.note ?? "" });
  });

  app.get("/versions/:id/anchor", (req, res) => {
    const v = db.prepare("SELECT * FROM record_versions WHERE id = ?").get(req.params.id);
    if (!v) return res.status(404).send("버전을 찾을 수 없습니다");
    res.render("anchor", { v, chain, personIdHex: ethers.id(v.person_slug) });
  });

  app.post("/versions/:id/anchored", (req, res) => {
    const { txHash, wallet } = req.body ?? {};
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) {
      return res.status(400).json({ error: "잘못된 txHash" });
    }
    const v = db.prepare("SELECT * FROM record_versions WHERE id = ?").get(req.params.id);
    if (!v) return res.status(404).json({ error: "버전 없음" });
    q.markAnchored(db, { versionId: Number(req.params.id), txHash, wallet });
    res.json({ ok: true });
  });

  // ponytail: 요청 제출·처리에 서버 로그인 없음 — v1 원칙 그대로, 실명과 처리자
  // 이름을 공개 기록으로 남기는 것이 유일한 책임 장치다.
  app.get("/requests", (req, res) => {
    const requests = q.listChangeRequests(db, { status: req.query.status });
    res.render("requests", { requests, status: req.query.status ?? "" });
  });

  app.get("/requests/new", (req, res) => {
    const person = q.getPerson(db, req.query.person);
    if (!person) return res.status(404).send("인물을 찾을 수 없습니다");
    res.render("request-new", { person });
  });

  app.post("/requests", (req, res) => {
    const { person, requesterName, contact, field, proposed, evidence } = req.body;
    if (!person || !requesterName || !contact || !field || !proposed || !evidence) {
      return res.status(400).send("이름, 연락처, 대상 필드, 제안 내용, 근거 출처는 모두 필수입니다");
    }
    if (!q.getPerson(db, person)) return res.status(404).send("인물을 찾을 수 없습니다");
    const id = q.addChangeRequest(db, {
      personSlug: person, requesterName, contact, field, proposed, evidence,
    });
    res.redirect(`/requests/${id}`);
  });

  app.get("/requests/:id", (req, res) => {
    const request = q.getChangeRequest(db, req.params.id);
    if (!request) return res.status(404).send("요청을 찾을 수 없습니다");
    res.render("request", { request, person: q.getPerson(db, request.person_slug) });
  });

  app.post("/requests/:id/resolve", (req, res) => {
    const request = q.getChangeRequest(db, req.params.id);
    if (!request) return res.status(404).send("요청을 찾을 수 없습니다");
    if (request.status !== "open") return res.status(409).send("이미 처리된 요청입니다");
    const { status, resolverName, note, versionId } = req.body;
    if (!["accepted", "rejected"].includes(status) || !resolverName) {
      return res.status(400).send("처리 상태와 처리자 이름은 필수입니다");
    }
    if (status === "rejected" && !note) return res.status(400).send("반려 사유는 필수입니다");
    let vid = null;
    if (versionId) {
      const v = db.prepare(
        "SELECT id FROM record_versions WHERE id = ? AND person_slug = ?"
      ).get(Number(versionId) || 0, request.person_slug);
      if (!v) return res.status(400).send("반영 버전이 해당 인물에 존재하지 않습니다");
      vid = v.id;
    }
    q.resolveChangeRequest(db, {
      id: Number(req.params.id), status, resolverName, note,
      versionId: vid,
    });
    res.redirect(`/requests/${req.params.id}`);
  });

  return app;
}
