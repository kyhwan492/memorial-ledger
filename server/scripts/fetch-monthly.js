// 국가보훈부 "이달의 독립운동가" 수집 → data/monthly.json.
// API 문서: https://e-gonghun.mpva.go.kr/user/IndepCrusaderOpenAPI.do?goTocode=50003
// 이 엔드포인트도 인증키 없이 동작한다 (실호출 확인).
// 사용: node scripts/fetch-monthly.js
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mapMonthly } from "./gonghun-map.js";

const API = "https://e-gonghun.mpva.go.kr/opnAPI/indepCrusaderList.do";
const PAGE_SIZE = 50; // 문서상 최대
const OUT = process.env.MONTHLY_PATH ?? "data/monthly.json";

async function fetchPage(pageIndex) {
  const res = await fetch(`${API}?nPageIndex=${pageIndex}&nCountPerPage=${PAGE_SIZE}&type=JSON`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).ITEMS ?? [];
}

const rows = [];
for (let page = 1; ; page++) {
  let items;
  try {
    items = await fetchPage(page);
  } catch (e) {
    console.error(`${page}페이지 실패(${e.message}) — 1회 재시도`);
    items = await fetchPage(page); // 재시도도 실패하면 그대로 중단
  }
  if (items.length === 0) break;
  rows.push(...items.map(mapMonthly).filter((r) => r.name && r.year && r.month));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rows, null, 2) + "\n");
console.log(`이달의 독립운동가 ${rows.length}건 → ${OUT}`);
