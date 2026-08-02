// MCP 도구의 순수 로직. db와 체인 의존성을 인자로 받으므로 MCP 없이도 테스트된다.
import { ethers } from "ethers";
import { canonicalize } from "../public/canonical.js";
import * as q from "../src/db.js";

const VERIFY_NOTE = "서버 측 검증 — 독립 검증은 웹 브라우저 검증 사용";

export function searchPersons(db, { q: query, category } = {}) {
  return q.listPersons(db, { q: query, category });
}

export function getPersonDetail(db, slug) {
  const person = q.getPerson(db, slug);
  if (!person) return null;
  return {
    person,
    sources: q.listSources(db, slug),
    versions: q.listVersions(db, slug),
  };
}

export async function verifyRecord(db, { contract }, { slug, versionId } = {}) {
  const version = versionId
    ? q.listVersions(db, slug).find((v) => v.id === Number(versionId))
    : q.latestAnchored(db, slug);
  if (!version || version.status !== "anchored") {
    return { verified: false, error: "앵커된 버전 없음", note: VERIFY_NOTE };
  }
  const localHash = ethers.keccak256(
    ethers.toUtf8Bytes(canonicalize(JSON.parse(version.content_json)))
  );
  const personId = ethers.id(slug);
  const [chainHash, author] = versionId
    ? await contract.getVersion(personId, q.chainIndexOf(db, version.id))
    : await contract.latest(personId);
  return { verified: chainHash === localHash, localHash, chainHash, author, note: VERIFY_NOTE };
}

export function submitChangeRequest(db, { personSlug, requesterName, contact, field, proposed, evidence } = {}) {
  if (!personSlug || !requesterName || !contact || !field || !proposed || !evidence) {
    throw new Error("필수값 누락: personSlug, requesterName, contact, field, proposed, evidence");
  }
  if (!q.getPerson(db, personSlug)) throw new Error("인물을 찾을 수 없습니다");
  return { id: q.addChangeRequest(db, { personSlug, requesterName, contact, field, proposed, evidence }) };
}

export function listRequests(db, { status } = {}) {
  return q.listChangeRequests(db, { status });
}
