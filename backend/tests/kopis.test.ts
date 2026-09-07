import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitNames, GENRES, listShows } from "../src/modules/kopis/index.ts";

describe("modules/kopis", () => {
  test("splitNames: 여러 구분자를 처리한다", () => {
    assert.deepEqual(splitNames("차인표, 오만석, 연정훈"), ["차인표", "오만석", "연정훈"]);
    assert.deepEqual(splitNames("김선영·정선아"), ["김선영", "정선아"]);
    assert.deepEqual(splitNames(""), []);
  });

  test("splitNames: 이름이 아닌 긴 문자열은 버린다", () => {
    const long = "가".repeat(40);
    assert.deepEqual(splitNames(`홍길동, ${long}`), ["홍길동"]);
  });

  test("장르 코드에 연극/뮤지컬이 있다", () => {
    assert.equal(GENRES.AAAA, "연극");
    assert.equal(GENRES.GGGA, "뮤지컬");
  });

  /**
   * ⚠️ 이게 이 프로젝트의 1순위 미검증 항목이다.
   * client.ts 의 필드명은 개발가이드 PDF 기준으로만 작성됐고 실제 응답과 대조된 적이 없다.
   * 인증키를 받으면 KOPIS_API_KEY=... npm test 로 가장 먼저 이걸 돌린다.
   */
  test(
    "live: 공연목록 응답 필드가 실제로 매핑된다",
    { skip: !process.env.KOPIS_API_KEY, timeout: 60_000 },
    async () => {
      const iso = (d: Date) =>
        `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      const today = new Date();
      const week = new Date(today.getTime() + 7 * 864e5);

      const list = await listShows({
        startDate: iso(today),
        endDate: iso(week),
        rows: 5,
        genre: "GGGA",
      });

      assert.ok(list.length > 0, "뮤지컬이 한 건도 안 나오면 응답 파싱이 틀린 것이다");
      const first = list[0]!;
      assert.match(first.id, /^PF\d+$/, `mt20id 매핑 실패: ${JSON.stringify(first)}`);
      assert.ok(first.name.length > 0, "prfnm 매핑 실패");
      assert.match(first.startDate, /^\d{4}-\d{2}-\d{2}$/, "prfpdfrom 날짜 정규화 실패");
    },
  );
});
