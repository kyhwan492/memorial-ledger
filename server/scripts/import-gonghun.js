// 국가보훈부 독립유공자 공훈록 임포트.
// API 문서: https://e-gonghun.mpva.go.kr/user/ContribuMeritOpenAPI.do?goTocode=50002
// 이 엔드포인트는 인증키 없이 동작한다 (실호출 확인).
// 사용: node scripts/import-gonghun.js [--limit 100] [--page 1]
import { openDb, upsertPerson, addSource, listSources } from "../src/db.js";
import { mapRow } from "./gonghun-map.js";

const API = "https://e-gonghun.mpva.go.kr/opnAPI/contribuMeritList.do";
const PAGE_SIZE = 50; // 문서상 최대. 페이지 창이 밀리지 않도록 항상 고정 크기로 요청한다
const SOURCE = { label: "국가보훈부 공훈전자사료관", url: "https://e-gonghun.mpva.go.kr/" };

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
outer: for (let page = startPage; imported < limit; page++) {
  let items;
  try {
    items = await fetchPage(page, PAGE_SIZE);
  } catch (e) {
    console.error(`${page}페이지 실패(${e.message}) — 1회 재시도`);
    items = await fetchPage(page, PAGE_SIZE); // 재시도도 실패하면 그대로 중단
  }
  if (items.length === 0) break; // 마지막 페이지

  for (const item of items) {
    if (imported >= limit) break outer;
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
