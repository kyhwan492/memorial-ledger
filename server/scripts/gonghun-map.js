// 공훈전자사료관 공훈록 목록조회 API의 ITEM 하나를 persons 레코드로 바꾸는 순수 함수.
// 응답 필드는 https://e-gonghun.mpva.go.kr/user/ContribuMeritOpenAPI.do?goTocode=50002 문서 기준.

const clean = (v) => (v ?? "").trim();

export function mapRow(item) {
  const name = clean(item.NAME_KO) || clean(item.NAME_CH);
  if (!name) throw new Error(`성명이 없는 항목: ${JSON.stringify(item).slice(0, 120)}`);

  const birth = clean(item.BIRTHDAY);
  const mngNo = clean(item.MNG_NO);
  // 관리번호가 있으면 그게 유일 키. 없으면 이름+생년으로 만든다(문서상 필수 필드가 아님).
  const slug = mngNo
    ? `gonghun-${mngNo}`
    : ["gonghun", name.replace(/\s+/g, "-"), birth.slice(0, 4)].filter(Boolean).join("-");

  return {
    slug,
    name,
    category: "independence",
    birth,
    death: clean(item.LASTDAY),
    // 공훈록 본문은 줄바꿈이 \r 로 온다
    summary: clean(item.ACHIVEMENT).split(/\s*\r\n?\s*/).map((s) => s.trim()).filter(Boolean).join("\n"),
    hunkuk: clean(item.HUNKUK),
    workoutAffil: clean(item.WORKOUT_AFFIL),
    judgeYear: clean(item.JUDGE_YEAR),
    alias: clean(item.DIFF_NAME),
    sex: clean(item.SEX),
  };
}

// REFERENCES는 {BOOK_NAME} 객체 배열이다(실응답 확인). 응답에 원문 링크는 없어서 label만 만든다.
export function mapReferences(item) {
  return (item.REFERENCES ?? [])
    .map((r) => ({ label: clean(r.BOOK_NAME) }))
    .filter((r) => r.label);
}

// 이달의 독립운동가(indepCrusaderList.do) 항목 → Task W와의 계약 스키마.
// ACHIVEMENT는 그 달 기획기사 전문이고, 맨 앞 조각이 "성명 (한자, 생몰, 훈격, 포상년도)" 한 줄이다
// (539건 전수 확인: 항상 존재하고 75자 이하). 그 줄을 요약으로 쓴다.
export function mapMonthly(item) {
  return {
    year: clean(item.POST_YEAR),
    month: clean(item.POST_MONTH),
    name: clean(item.NAME_KO) || clean(item.NAME_CH),
    mngNo: clean(item.MNG_NO),
    summary: clean(item.ACHIVEMENT).split(/\s{2,}/)[0].trim(),
  };
}
