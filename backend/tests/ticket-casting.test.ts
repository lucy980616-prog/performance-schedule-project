import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CastingExtraction, validEntries } from "../src/modules/ticket-casting/schema.ts";
import { transformText, transformImages } from "../src/modules/ticket-casting/transform.ts";
import {
  normalizeTitle,
  titleSimilarity,
  MATCH_THRESHOLD,
} from "../src/modules/ticket-casting/discover.ts";

const FIXTURES = path.join(import.meta.dirname, "..", "fixtures", "ticket-casting");
const NO_LIVE = process.env.RUN_LIVE !== "1";

describe("ticket-casting / schema", () => {
  test("정상 응답을 통과시킨다", () => {
    const ok = CastingExtraction.safeParse({
      entries: [{ date: "2026-09-10", time: "19:30", actors: ["홍길동"], note: null }],
      roles: [{ role: "지킬", actors: ["홍길동"] }],
      warnings: [],
    });
    assert.ok(ok.success);
  });

  test("필드가 빠지면 막는다", () => {
    const bad = CastingExtraction.safeParse({ entries: [{ date: "2026-09-10" }] });
    assert.equal(bad.success, false);
  });

  test("validEntries: 형식이 깨진 회차를 걸러낸다", () => {
    const filtered = validEntries({
      entries: [
        { date: "2026-09-10", time: "19:30", actors: ["A"], note: null },
        { date: "9월 10일", time: "19:30", actors: ["B"], note: null },
        { date: "2026-09-10", time: "저녁 7시반", actors: ["C"], note: null },
      ],
      roles: [],
      warnings: [],
    });
    assert.equal(filtered.length, 1);
    assert.deepEqual(filtered[0]!.actors, ["A"]);
  });
});

describe("ticket-casting / discover (2-1)", () => {
  test("normalizeTitle: 장르·지역·괄호 표기를 걷어낸다", () => {
    assert.equal(normalizeTitle("뮤지컬 <지킬 앤 하이드> [서울]"), "지킬앤하이드");
    assert.equal(normalizeTitle("연극 햄릿(재공연)"), "햄릿");
  });

  test("같은 공연의 다른 표기는 임계값을 넘는다", () => {
    const pairs: [string, string][] = [
      ["뮤지컬 지킬앤하이드", "지킬 앤 하이드 [서울]"],
      ["레베카", "뮤지컬 <레베카>"],
      ["프랑켄슈타인", "뮤지컬 프랑켄슈타인 (앙코르)"],
    ];
    for (const [a, b] of pairs) {
      assert.ok(
        titleSimilarity(a, b) >= MATCH_THRESHOLD,
        `${a} vs ${b} = ${titleSimilarity(a, b).toFixed(2)}`,
      );
    }
  });

  test("다른 공연은 임계값을 넘지 못한다 — 잘못 잇느니 비워 둔다", () => {
    const pairs: [string, string][] = [
      ["지킬앤하이드", "레베카"],
      ["햄릿", "맥베스"],
      ["프랑켄슈타인", "프리다"],
    ];
    for (const [a, b] of pairs) {
      assert.ok(
        titleSimilarity(a, b) < MATCH_THRESHOLD,
        `${a} vs ${b} = ${titleSimilarity(a, b).toFixed(2)}`,
      );
    }
  });
});

describe("ticket-casting / transform (2-2)", () => {
  test("live: 텍스트에서 회차를 뽑아낸다", { skip: NO_LIVE, timeout: 300_000 }, async () => {
    const got = await transformText(
      [
        "9/10(수) 7:30PM  지킬-홍길동 / 루시-김영희",
        "9/12(금) 8:00PM  지킬-이철수 / 루시-김영희",
      ].join("\n"),
      { showName: "테스트 뮤지컬", startDate: "2026-09-01", endDate: "2026-09-30" },
    );
    const entries = validEntries(got);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.date, "2026-09-10");
    assert.equal(entries[0]!.time, "19:30");
  });

  /**
   * fixtures/ticket-casting/ 에 실제 캐스팅표 캡처(.png)를 넣어두고 돌린다.
   * 스크래핑 없이 판독만 반복 검증하는 용도 — 프롬프트를 고칠 때 여기부터 돌린다.
   */
  test("live: fixtures 캡처를 회차로 옮긴다", { skip: NO_LIVE, timeout: 300_000 }, async (t) => {
    const images = fs.existsSync(FIXTURES)
      ? fs.readdirSync(FIXTURES).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      : [];
    if (images.length === 0) {
      t.skip("fixtures/ticket-casting 에 캡처 이미지가 없습니다.");
      return;
    }

    const got = await transformImages(
      images.map((f) => path.join(FIXTURES, f)),
      { showName: "(fixture)", startDate: "2026-01-01", endDate: "2026-12-31" },
    );
    assert.ok(
      validEntries(got).length > 0,
      `회차를 하나도 못 뽑았습니다: ${JSON.stringify(got.warnings)}`,
    );
  });
});
