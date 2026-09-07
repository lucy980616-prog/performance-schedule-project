import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseGenreListing,
  parseGoodsKey,
  toCastingExtraction,
  fetchGenreListing,
  fetchShowSummary,
  fetchAllCasting,
  type NolCastingEntry,
} from "../src/modules/ticket-casting/nol.ts";
import { validEntries } from "../src/modules/ticket-casting/schema.ts";

const NO_LIVE = process.env.RUN_LIVE !== "1";

/**
 * 실물 구조를 흉내낸 최소 조각. 2026-09-07 실측(§2 ②)에서 확인한 그대로 —
 * Next.js가 self.__next_f.push([1,"...(JSON-escape된 문자열)..."]) 안에
 * "id":"{goodsCode}:{placeCode}" 형태로 목록 데이터를 심어 둔다.
 */
function fakeGenreHtml(items: { id: string; title: string; dateInfo: string; venue: string }[]): string {
  const body = items
    .map(
      (it) =>
        `\\"id\\":\\"${it.id}\\" mid \\"title\\":\\"${it.title}\\" mid2 \\"dateInfo\\":\\"${it.dateInfo}\\" mid3 \\"locationDetails\\":[\\"${it.venue}\\"]`,
    )
    .join(" sep ");
  return `<script>self.__next_f.push([1,"prefix ${body} suffix"])</script>`;
}

describe("ticket-casting / nol — parseGenreListing (발견)", () => {
  test("id/title/dateInfo/venue를 뽑는다", () => {
    const html = fakeGenreHtml([
      { id: "26010918:26000902", title: "연극 〈클로저〉", dateInfo: "26.09.15 ~ 26.12.06", venue: "예스24스테이지 2관" },
    ]);
    const items = parseGenreListing(html, "play");
    assert.equal(items.length, 1);
    assert.equal(items[0]!.goodsCode, "26010918");
    assert.equal(items[0]!.placeCode, "26000902");
    assert.equal(items[0]!.goodsKey, "26010918:26000902");
    assert.equal(items[0]!.title, "연극 〈클로저〉");
    assert.equal(items[0]!.venue, "예스24스테이지 2관");
  });

  test("같은 goodsKey가 여러 위젯에 중복 등장해도 한 번만 남는다", () => {
    const html = fakeGenreHtml([
      { id: "26010918:26000902", title: "연극 〈클로저〉", dateInfo: "1", venue: "A" },
      { id: "26010918:26000902", title: "연극 〈클로저〉(다른 위젯)", dateInfo: "2", venue: "B" },
    ]);
    assert.equal(parseGenreListing(html, "play").length, 1);
  });

  test("항목을 하나도 못 찾으면 빈 배열이 아니라 에러다", () => {
    // 조용한 빈 결과 금지 원칙 — 페이지 구조가 바뀌면 즉시 알아야 한다.
    assert.throws(() => parseGenreListing("<html><body>no data</body></html>", "musical"), /항목을 하나도/);
  });
});

describe("ticket-casting / nol — parseGoodsKey", () => {
  test("상세페이지 텍스트에서 goodsKey를 찾는다", () => {
    const html = `<script>...어딘가에 26007505:25001547 이 박혀있음...</script>`;
    assert.equal(parseGoodsKey(html, "26007505"), "26007505:25001547");
  });

  test("못 찾으면 에러다", () => {
    assert.throws(() => parseGoodsKey("<html>아무것도 없음</html>", "26007505"), /goodsKey/);
  });
});

describe("ticket-casting / nol — toCastingExtraction (2-2를 건너뛴다)", () => {
  const sample: NolCastingEntry[] = [
    {
      playSeq: "091",
      playDate: "2026-09-08",
      playTime: "19:30",
      dayOfWeek: "화",
      castingList: [
        { characterName: "제인 존슨", manName: "표바하" },
        { characterName: "빌리 후커", manName: "홍기범" },
      ],
    },
    {
      playSeq: "092",
      playDate: "2026-09-09",
      playTime: "19:30",
      dayOfWeek: "수",
      castingList: [
        { characterName: "제인 존슨", manName: "조영화" },
        { characterName: "빌리 후커", manName: "박규원" },
      ],
    },
  ];

  test("entries가 그대로 옮겨지고 note는 null이다", () => {
    const got = toCastingExtraction(sample);
    assert.equal(got.entries.length, 2);
    assert.equal(got.entries[0]!.date, "2026-09-08");
    assert.equal(got.entries[0]!.time, "19:30");
    assert.deepEqual(got.entries[0]!.actors, ["표바하", "홍기범"]);
    assert.equal(got.entries[0]!.note, null);
  });

  test("배역별로 배우를 묶는다 (roles)", () => {
    const got = toCastingExtraction(sample);
    const byRole = Object.fromEntries(got.roles.map((r) => [r.role, r.actors]));
    assert.deepEqual(new Set(byRole["제인 존슨"]), new Set(["표바하", "조영화"]));
    assert.deepEqual(new Set(byRole["빌리 후커"]), new Set(["홍기범", "박규원"]));
  });

  test("AI를 거치지 않으므로 warnings는 항상 빈 배열이다", () => {
    assert.deepEqual(toCastingExtraction(sample).warnings, []);
  });

  test("zod 스키마를 통과한 값만 돌려준다 — validEntries와도 호환된다", () => {
    const got = toCastingExtraction(sample);
    assert.equal(validEntries(got).length, 2);
  });
});

describe("ticket-casting / nol — live", () => {
  const GOODS_CODE = "26007505"; // 뮤지컬 웨스턴 스토리

  test("장르 목록에서 실제 공연을 찾는다", { skip: NO_LIVE, timeout: 60_000 }, async () => {
    const items = await fetchGenreListing("musical");
    assert.ok(items.length > 0);
    assert.ok(items.every((i) => /^\d+$/.test(i.goodsCode) && /^\d+$/.test(i.placeCode)));
  });

  test("상세페이지에서 goodsKey를 얻는다", { skip: NO_LIVE, timeout: 60_000 }, async () => {
    const summary = await fetchShowSummary(GOODS_CODE);
    assert.equal(summary.goodsCode, GOODS_CODE);
    assert.match(summary.goodsKey, /^\d+:\d+$/);
    assert.ok(summary.name.length > 0);
  });

  test("회차별 캐스팅을 구조화 데이터로 얻는다", { skip: NO_LIVE, timeout: 60_000 }, async () => {
    const summary = await fetchShowSummary(GOODS_CODE);
    const entries = await fetchAllCasting(summary.goodsKey);
    assert.ok(entries.length > 0);
    const extraction = toCastingExtraction(entries);
    assert.ok(validEntries(extraction).length > 0);
    assert.ok(extraction.roles.length > 0);
  });
});
