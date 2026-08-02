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
    : `gonghun-${name.replace(/\s+/g, "-")}-${birth.slice(0, 4)}`;

  return {
    slug,
    name,
    category: "independence",
    birth,
    death: clean(item.LASTDAY),
    // 공훈록 본문은 줄바꿈이 \r 로 온다
    summary: clean(item.ACHIVEMENT).split(/\s*\r\n?\s*/).map((s) => s.trim()).filter(Boolean).join("\n"),
  };
}
