import test from "node:test";
import assert from "node:assert/strict";
import { mapRow, mapReferences, mapMonthly } from "../scripts/gonghun-map.js";

// 실제 API 응답에서 잘라온 픽스처
// https://e-gonghun.mpva.go.kr/opnAPI/contribuMeritList.do?nPageIndex=1&nCountPerPage=1&type=JSON
const ITEM = {
  MNG_NO: "950430",
  NAME_KO: "가네코 후미코",
  NAME_CH: "金子文子",
  DIFF_NAME: "",
  BIRTHDAY: "1903-01-25",
  BIRTHDAY_SL_NM: "",
  BIRTHDAY_EXT_NM: "",
  LASTDAY: "1926-07-23",
  LASTDAY_SL_NM: "",
  LASTDAY_EXT_NM: "",
  SEX: "여",
  REGISTER_LARGE_DIV: "외국",
  REGISTER_MID_DIV: "일본",
  REGISTER_SMALL_DIV: "山梨 東山梨 諏訪村杣口 1236",
  JUDGE_YEAR: "2018",
  HUNKUK: "애국장",
  WORKOUT_AFFIL: "독립운동지원",
  ACHIVEMENT: "1922년 2월부터 박열과 의기투합하였다. \r 1926년 옥중에서 순국하였다.\r ",
  REFERENCES: [{ BOOK_NAME: "판결문(判決文)(대심원 제1특별형사부, 1926. 3. 25)" }],
};

test("공훈록 항목을 person 레코드로 매핑한다", () => {
  assert.deepEqual(mapRow(ITEM), {
    slug: "gonghun-950430",
    name: "가네코 후미코",
    category: "independence",
    birth: "1903-01-25",
    death: "1926-07-23",
    summary: "1922년 2월부터 박열과 의기투합하였다.\n1926년 옥중에서 순국하였다.",
    hunkuk: "애국장",
    workoutAffil: "독립운동지원",
    judgeYear: "2018",
    alias: "",
    sex: "여",
  });
});

test("관리번호가 없으면 이름과 생년으로 slug를 만든다", () => {
  const r = mapRow({ ...ITEM, MNG_NO: "" });
  assert.equal(r.slug, "gonghun-가네코-후미코-1903");
});

test("빈 필드는 빈 문자열이 된다", () => {
  const r = mapRow({ MNG_NO: "8108", NAME_KO: "김아무개" });
  assert.deepEqual(r, {
    slug: "gonghun-8108",
    name: "김아무개",
    category: "independence",
    birth: "",
    death: "",
    summary: "",
    hunkuk: "",
    workoutAffil: "",
    judgeYear: "",
    alias: "",
    sex: "",
  });
});

test("한글 성명이 없으면 한자 성명을 쓴다", () => {
  assert.equal(mapRow({ MNG_NO: "1", NAME_KO: "", NAME_CH: "金子文子" }).name, "金子文子");
});

test("성명이 아예 없으면 거부한다", () => {
  assert.throws(() => mapRow({ MNG_NO: "1" }), /성명/);
});

test("mapRow가 훈격·운동계열·서훈년도·이명·성별을 매핑한다", () => {
  const row = mapRow({ ...ITEM, DIFF_NAME: "박문자" });
  assert.equal(row.hunkuk, "애국장");
  assert.equal(row.workoutAffil, "독립운동지원");
  assert.equal(row.judgeYear, "2018");
  assert.equal(row.alias, "박문자");
  assert.equal(row.sex, "여");
});

test("mapReferences가 참고문헌을 출처 항목으로 만든다", () => {
  const refs = mapReferences(ITEM);
  assert.deepEqual(refs, [{ label: "판결문(判決文)(대심원 제1특별형사부, 1926. 3. 25)" }]);
});

test("REFERENCES가 없거나 비면 빈 배열이다", () => {
  assert.deepEqual(mapReferences({}), []);
  assert.deepEqual(mapReferences({ REFERENCES: [{ BOOK_NAME: " " }] }), []);
});

// 이달의 독립운동가 실응답에서 잘라온 픽스처
// https://e-gonghun.mpva.go.kr/opnAPI/indepCrusaderList.do?nPageIndex=1&nCountPerPage=1&type=JSON
const MONTHLY_ITEM = {
  MNG_NO: "779",
  NAME_KO: "이세영",
  POST_YEAR: "2026",
  POST_MONTH: "08",
  ACHIVEMENT: "이세영 (李世永, 1870-05-29 ~ 1941-05-28, 독립장, 1963)   목차 1.의병에서 독립군으로 이어진 무장독립투쟁  활동 1. 우리의 힘으로",
};

test("mapMonthly가 이달의 독립운동가 항목을 계약 스키마로 바꾼다", () => {
  assert.deepEqual(mapMonthly(MONTHLY_ITEM), {
    year: "2026",
    month: "08",
    name: "이세영",
    mngNo: "779",
    summary: "이세영 (李世永, 1870-05-29 ~ 1941-05-28, 독립장, 1963)",
  });
});
