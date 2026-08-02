// 국가보훈부 독립유공자 공훈록 임포트.
// API 문서: https://e-gonghun.mpva.go.kr/user/ContribuMeritOpenAPI.do?goTocode=50002
// 사용: GONGHUN_API_KEY=... node scripts/import-gonghun.js [--limit 100] [--page 1]
import { openDb, upsertPerson, addSource, listSources } from "../src/db.js";
import { mapRow } from "./gonghun-map.js";

const API = "https://e-gonghun.mpva.go.kr/opnAPI/contribuMeritList.do";
const PAGE_SIZE = 50; // 문서상 최대
const SOURCE = { label: "국가보훈부 공훈전자사료관", url: "https://e-gonghun.mpva.go.kr/" };

const USAGE = `사용법: GONGHUN_API_KEY=<data.go.kr 인증키> node scripts/import-gonghun.js [--limit 100] [--page 1]

  --limit N   가져올 인원 수 (기본 100)
  --page N    시작 페이지 (1부터, 페이지당 ${PAGE_SIZE}명)
  DB_PATH     대상 SQLite 파일 (기본 data/ledger.db)`;

if (!process.env.GONGHUN_API_KEY) {
  console.error(USAGE);
  process.exit(1);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

async function fetchPage(pageIndex, count) {
  const url = `${API}?nPageIndex=${pageIndex}&nCountPerPage=${count}&type=JSON`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).ITEMS ?? [];
}

const limit = arg("limit", 100);
const startPage = arg("page", 1);
const db = openDb(process.env.DB_PATH ?? "data/ledger.db");

let imported = 0;
for (let page = startPage; imported < limit; page++) {
  const count = Math.min(PAGE_SIZE, limit - imported);
  let items;
  try {
    items = await fetchPage(page, count);
  } catch (e) {
    console.error(`${page}페이지 실패(${e.message}) — 1회 재시도`);
    items = await fetchPage(page, count); // 재시도도 실패하면 그대로 중단
  }
  if (items.length === 0) break; // 마지막 페이지

  for (const item of items) {
    let person;
    try {
      person = mapRow(item);
    } catch (e) {
      console.error(`건너뜀: ${e.message}`);
      continue;
    }
    upsertPerson(db, person);
    // 재실행해도 출처가 중복되지 않게 확인 후 추가
    if (!listSources(db, person.slug).some((s) => s.url === SOURCE.url)) {
      addSource(db, { personSlug: person.slug, ...SOURCE });
    }
    imported++;
  }
}

console.log(`임포트 완료: ${imported}명`);
