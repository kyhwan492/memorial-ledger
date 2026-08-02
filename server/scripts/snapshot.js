// 공개 스냅샷 export/import — 원본 데이터를 저장소에 커밋해 누구나 미러할 수 있게 한다.
// 연락처(requester_contact)는 공개용이 아니므로 export에서 제외된다(복원 시 빈 값).
// 사용:
//   node scripts/snapshot.js export [dir=../data-snapshot]
//   node scripts/snapshot.js import [dir=../data-snapshot]   (DB_PATH 대상, 기존 행 위에 upsert/재삽입)
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.js";

const TABLES = {
  persons: { order: "slug", redact: [] },
  sources: { order: "id", redact: [] },
  authors: { order: "id", redact: [] },
  record_versions: { order: "id", redact: [] },
  change_requests: { order: "id", redact: ["requester_contact"] },
  reviews: { order: "id", redact: [] },
};

const [, , cmd, dirArg] = process.argv;
const dir = dirArg ?? join(import.meta.dirname, "..", "..", "data-snapshot");
const db = openDb(process.env.DB_PATH ?? "data/ledger.db");

if (cmd === "export") {
  mkdirSync(dir, { recursive: true });
  for (const [table, { order, redact }] of Object.entries(TABLES)) {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all()
      .map((row) => {
        for (const col of redact) delete row[col];
        return row;
      });
    writeFileSync(join(dir, `${table}.json`), JSON.stringify(rows, null, 2) + "\n");
    console.log(`${table}: ${rows.length}행`);
  }
  console.log(`스냅샷 export 완료: ${dir}`);
} else if (cmd === "import") {
  let total = 0;
  db.exec("PRAGMA foreign_keys = OFF;"); // 테이블 순서 무관 복원 (스냅샷은 정합 상태)
  for (const [table, { redact }] of Object.entries(TABLES)) {
    const rows = JSON.parse(readFileSync(join(dir, `${table}.json`), "utf8"));
    for (const row of rows) {
      for (const col of redact) row[col] = row[col] ?? ""; // 제외된 컬럼은 빈 값으로
      const cols = Object.keys(row);
      db.prepare(
        `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
      ).run(...cols.map((c) => row[c]));
      total++;
    }
    console.log(`${table}: ${rows.length}행`);
  }
  db.exec("PRAGMA foreign_keys = ON;");
  console.log(`스냅샷 import 완료: ${total}행`);
} else {
  console.error("사용법: node scripts/snapshot.js export|import [dir]");
  process.exit(1);
}
