import test from "node:test";
import assert from "node:assert/strict";
import { mapRow } from "../scripts/gonghun-map.js";

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
  });
});

test("한글 성명이 없으면 한자 성명을 쓴다", () => {
  assert.equal(mapRow({ MNG_NO: "1", NAME_KO: "", NAME_CH: "金子文子" }).name, "金子文子");
});

test("성명이 아예 없으면 거부한다", () => {
  assert.throws(() => mapRow({ MNG_NO: "1" }), /성명/);
});
