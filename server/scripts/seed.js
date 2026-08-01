import { mkdirSync } from "node:fs";
import path from "node:path";
import { openDb, upsertPerson, addSource, addAuthor } from "../src/db.js";

const dbPath = process.env.DB_PATH ?? "data/ledger.db";
mkdirSync(path.dirname(dbPath), { recursive: true }); // data/는 gitignore되어 없을 수 있음
const db = openDb(dbPath);

const PERSONS = [
  { slug: "kim-gu", name: "김구", category: "independence", birth: "1876", death: "1949",
    summary: "대한민국 임시정부 주석. 한인애국단을 조직해 항일 의거를 이끌었다." },
  { slug: "an-junggeun", name: "안중근", category: "independence", birth: "1879", death: "1910",
    summary: "1909년 하얼빈에서 이토 히로부미를 저격한 독립운동가. 동양평화론을 저술했다." },
  { slug: "yu-gwansun", name: "유관순", category: "independence", birth: "1902", death: "1920",
    summary: "3·1 운동의 상징적 인물. 아우내 장터 만세운동을 주도하고 옥중에서 순국했다." },
  { slug: "yun-bonggil", name: "윤봉길", category: "independence", birth: "1908", death: "1932",
    summary: "1932년 상하이 훙커우 공원 의거를 결행한 한인애국단 단원." },
  { slug: "an-changho", name: "안창호", category: "independence", birth: "1878", death: "1938",
    summary: "흥사단을 창립한 독립운동가이자 교육자. 임시정부 내무총장을 지냈다." },
];

for (const p of PERSONS) {
  upsertPerson(db, p);
  addSource(db, {
    personSlug: p.slug,
    label: "국가보훈부 공훈전자사료관",
    url: "https://e-gonghun.mpva.go.kr/",
  });
}

// hardhat 로컬 계정 #1 — contracts/scripts/deploy.js가 온체인에도 등록하는 지갑
addAuthor(db, {
  name: "로컬 테스트 작성자",
  credential: "개발용 (hardhat account #1)",
  wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
});

console.log(`시드 완료: 인물 ${PERSONS.length}명, 작성자 1명`);
