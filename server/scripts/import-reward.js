// 독립유공자 공적조서 임포트 — 원장의 공훈록 인물(gonghun-<관리번호>)에 공적조서 출처를 붙인다.
// API 문서: https://e-gonghun.mpva.go.kr/user/RewardOpenAPI.do?goTocode=50001
// mngNo로 단건 조회되고 인증키가 필요 없다 (실호출 확인).
// 사료관에 관리번호로 여는 공적조서 상세 페이지가 없어(확인 실패) 출처 url은 조회 API 주소를 쓴다.
// 사용: node scripts/import-reward.js [--limit 100]
import { openDb, listPersons, addSource, listSources } from "../src/db.js";

const API = "https://e-gonghun.mpva.go.kr/opnAPI/publicReportList.do";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

const queryUrl = (mngNo) => `${API}?nPageIndex=1&nCountPerPage=1&type=JSON&mngNo=${mngNo}`;

async function fetchReward(mngNo) {
  const res = await fetch(queryUrl(mngNo));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).ITEMS?.[0] ?? null;
}

const limit = arg("limit", 100);
const db = openDb(process.env.DB_PATH ?? "data/ledger.db");

// 관리번호 기반 slug만 조회 가능하다. 이름으로 만든 fallback slug는 건너뛴다
const targets = listPersons(db)
  .map((p) => ({ slug: p.slug, mngNo: /^gonghun-(\d+)$/.exec(p.slug)?.[1] }))
  .filter((t) => t.mngNo)
  .slice(0, limit);

let added = 0;
for (const { slug, mngNo } of targets) {
  let item;
  try {
    item = await fetchReward(mngNo);
  } catch (e) {
    console.error(`${slug} 실패: ${e.message}`);
    continue;
  }
  if (!item) continue;

  const year = (item.JUDGE_YEAR ?? "").trim();
  const source = { label: year ? `공적조서(${year})` : "공적조서", url: queryUrl(mngNo) };
  if (listSources(db, slug).some((s) => s.label === source.label && s.url === source.url)) continue;
  addSource(db, { personSlug: slug, ...source });
  added++;
}

console.log(`공적조서 출처 추가: ${added}건 / 대상 ${targets.length}명`);
