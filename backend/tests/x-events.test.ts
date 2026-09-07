import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EventExtraction } from "../src/modules/x-events/schema.ts";
import { parseTimeline, fetchTimeline } from "../src/modules/x-events/syndication.ts";
import { transformPost } from "../src/modules/x-events/transform.ts";
import type { ExtractedBundle } from "../src/shared/etl.ts";

const NO_LIVE = process.env.RUN_LIVE !== "1";

/** 신디케이션 응답 모양 그대로의 최소 HTML. 실물 구조는 2026-09-07 실측으로 확인했다. */
function fakeSyndicationHtml(tweets: unknown[]): string {
  const payload = {
    props: { pageProps: { timeline: { entries: tweets.map((t) => ({ type: "tweet", content: { tweet: t } })) } } },
  };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;
}

describe("x-events / syndication (3-1)", () => {
  test("__NEXT_DATA__ 에서 트윗을 꺼낸다", () => {
    const html = fakeSyndicationHtml([
      { id_str: "100", created_at: "Wed Sep 17 10:58:28 +0000 2025", full_text: "안녕" },
      { id_str: "101", created_at: "Thu Sep 18 10:58:28 +0000 2025", text: "둘째" },
    ]);
    const got = parseTimeline(html);
    assert.equal(got.length, 2);
    assert.equal(got[0]!.id_str, "100");
  });

  test("id_str 없는 엔트리는 버린다", () => {
    const got = parseTimeline(fakeSyndicationHtml([{ full_text: "id 없음" }, { id_str: "5" }]));
    assert.equal(got.length, 1);
  });

  test("__NEXT_DATA__ 가 없으면 빈 배열이 아니라 에러다", () => {
    // 조용한 빈 결과는 데이터가 비어가는 걸 몇 주 뒤에나 알게 만든다.
    assert.throws(() => parseTimeline("<html><body>로그인이 필요합니다</body></html>"), /__NEXT_DATA__/);
  });

  test("JSON이 깨져 있으면 에러다", () => {
    const broken = '<script id="__NEXT_DATA__" type="application/json">{not json}</script>';
    assert.throws(() => parseTimeline(broken), /파싱 실패/);
  });

  /**
   * 실제 엔드포인트 확인. 2026-09-07 실측에서 100건/최신 4일 전이었다.
   *   RUN_LIVE=1 X_TEST_HANDLE=계정명 npm test
   */
  test(
    "live: 실제 계정에서 게시물을 읽는다",
    { skip: NO_LIVE || !process.env.X_TEST_HANDLE, timeout: 120_000 },
    async () => {
      const bundles = await fetchTimeline({ handle: process.env.X_TEST_HANDLE!, limit: 5 });
      assert.ok(bundles.length > 0, "게시물을 하나도 못 읽었습니다");

      for (const b of bundles) {
        assert.equal(b.source, "x");
        assert.match(b.sourceId, /^\d+$/);
        assert.match(b.url, /^https:\/\/x\.com\//);
      }
      assert.ok(
        bundles.some((b) => b.text.length > 0),
        "본문이 전부 비었습니다 — 신디케이션 응답 구조가 바뀌었을 수 있습니다",
      );
      // 최신순 정렬
      const ids = bundles.map((b) => BigInt(b.sourceId));
      for (let i = 1; i < ids.length; i++) assert.ok(ids[i - 1]! > ids[i]!);
    },
  );

  test(
    "live: sinceId 이후만 돌려준다 (중복 제외)",
    { skip: NO_LIVE || !process.env.X_TEST_HANDLE, timeout: 120_000 },
    async () => {
      const all = await fetchTimeline({ handle: process.env.X_TEST_HANDLE!, limit: 5 });
      if (all.length < 2) return;

      const cutoff = all[1]!.sourceId; // 두 번째로 새 글까지 이미 봤다고 치면
      const fresh = await fetchTimeline({ handle: process.env.X_TEST_HANDLE!, sinceId: cutoff });
      assert.ok(fresh.every((b) => BigInt(b.sourceId) > BigInt(cutoff)));
      assert.equal(fresh[0]!.sourceId, all[0]!.sourceId);
    },
  );
});

describe("x-events / schema", () => {
  test("이벤트 없음(빈 배열)도 정상이다", () => {
    assert.ok(EventExtraction.safeParse({ events: [], warnings: [] }).success);
  });

  test("confidence 범위를 강제한다", () => {
    const bad = EventExtraction.safeParse({
      events: [
        {
          kind: "커튼콜",
          title: "t",
          showName: null,
          date: null,
          time: null,
          description: "d",
          confidence: 1.5,
        },
      ],
      warnings: [],
    });
    assert.equal(bad.success, false);
  });
});

describe("x-events / transform (3-2)", () => {
  test("live: 본문에서 커튼콜 일정을 잡아낸다", { skip: NO_LIVE, timeout: 300_000 }, async () => {
    const bundle: ExtractedBundle = {
      source: "x",
      sourceId: "1",
      url: "https://x.com/test/status/1",
      fetchedAt: new Date().toISOString(),
      postedAt: "2026-09-01T00:00:00.000Z",
      text: "[스페셜 커튼콜] 9월 20일(토) 오후 3시 공연 종료 후 스페셜 커튼콜이 진행됩니다.",
      imagePaths: [],
      imageUrls: [],
      meta: { handle: "test" },
    };

    const got = await transformPost(bundle);
    assert.equal(got.sourceId, "1");
    assert.ok(got.data.events.length >= 1, "커튼콜 공지를 못 잡았습니다");
    assert.equal(got.data.events[0]!.date, "2026-09-20");
  });
});
