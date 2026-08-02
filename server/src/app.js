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
    res.render("person", {
      person, CATEGORIES, chain,
      sources: q.listSources(db, person.slug),
      versions: q.listVersions(db, person.slug),
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
    const { slug, name, category, birth, death, summary } = req.body;
    if (!slug || !name || !CATEGORIES[category]) {
      return res.status(400).send("slug, 이름, 분류는 필수입니다");
    }
    q.upsertPerson(db, { slug, name, category, birth, death, summary });
    const content = {
      slug, name, category,
      birth: birth ?? "", death: death ?? "", summary: summary ?? "",
      sources: q.listSources(db, slug).map((s) => ({ label: s.label, url: s.url })),
    };
    const canonical = canonicalize(content);
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(canonical));
    const versionId = q.createDraft(db, { personSlug: slug, contentJson: canonical, contentHash });
    res.redirect(`/versions/${versionId}/anchor`);
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

  return app;
}
