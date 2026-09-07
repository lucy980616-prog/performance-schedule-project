import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/shared/db.ts";
import { upsertShow, getShow, saveCasting } from "../src/modules/ticket-casting/load.ts";
import type { CastingExtraction } from "../src/modules/ticket-casting/schema.ts";
import {
  upsertAccount,
  getAccount,
  updateLastSeen,
  saveEvents,
} from "../src/modules/x-events/load.ts";
import { wrap, type ExtractedBundle } from "../src/shared/etl.ts";
import type { EventExtraction } from "../src/modules/x-events/schema.ts";

/**
 * 저장소(backend/data/collector.db) 왕복 검증.
 * 테스트 데이터는 source_id/handle을 `_test_` 접두사로 구분해 실제 수집 데이터와 섞이지 않게 한다.
 */
describe("shared/db + ticket-casting/load", () => {
  test("upsertShow: 같은 (source, source_id)는 갱신이지 새 행이 아니다", () => {
    const id1 = upsertShow({ source: "_test_nol", sourceId: "T1", name: "첫 이름" });
    const id2 = upsertShow({ source: "_test_nol", sourceId: "T1", name: "바뀐 이름" });
    assert.equal(id1, id2);

    const row = getShow("_test_nol", "T1");
    assert.equal(row?.name, "바뀐 이름");
  });

  test("saveCasting: 회차·캐스팅·배역이 각 테이블에 저장된다", () => {
    const showId = upsertShow({
      source: "_test_nol",
      sourceId: "T2",
      name: "테스트 공연",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });

    const extraction: CastingExtraction = {
      entries: [
        { date: "2026-09-10", time: "19:30", actors: ["배우A", "배우B"], note: "첫공" },
        { date: "2026-09-11", time: "19:30", actors: ["배우A", "배우C"], note: null },
      ],
      roles: [
        { role: "역할1", actors: ["배우A"] },
        { role: "역할2", actors: ["배우B", "배우C"] },
      ],
      warnings: [],
    };

    const result = saveCasting(showId, extraction, "nol-api");
    assert.equal(result.showtimes, 2);
    assert.equal(result.castings, 4);
    assert.equal(result.roles, 2);

    const showtimes = db()
      .prepare(`SELECT date, time, note FROM showtimes WHERE show_id = ? ORDER BY date`)
      .all(showId) as { date: string; time: string; note: string | null }[];
    assert.equal(showtimes.length, 2);
    assert.equal(showtimes[0]!.note, "첫공");

    const castings = db()
      .prepare(
        `SELECT c.actor, c.role, c.source FROM castings c
         JOIN showtimes s ON s.id = c.showtime_id
         WHERE s.show_id = ? AND s.date = '2026-09-10' ORDER BY c.actor`,
      )
      .all(showId) as { actor: string; role: string | null; source: string }[];
    assert.deepEqual(
      castings.map((c) => c.actor),
      ["배우A", "배우B"],
    );
    assert.equal(castings[0]!.role, "역할1");
    assert.equal(castings[0]!.source, "nol-api");
  });

  test("saveCasting을 다시 호출하면 덮어쓰지 중복되지 않는다", () => {
    const showId = upsertShow({ source: "_test_nol", sourceId: "T3", name: "재저장 테스트" });
    const extraction: CastingExtraction = {
      entries: [{ date: "2026-10-01", time: "19:00", actors: ["배우A"], note: null }],
      roles: [],
      warnings: [],
    };
    saveCasting(showId, extraction, "nol-api");
    saveCasting(showId, extraction, "nol-api");

    const count = db()
      .prepare(
        `SELECT COUNT(*) as n FROM castings c JOIN showtimes s ON s.id = c.showtime_id WHERE s.show_id = ?`,
      )
      .get(showId) as { n: number };
    assert.equal(count.n, 1);
  });
});

describe("x-events/load", () => {
  test("upsertAccount + updateLastSeen", () => {
    upsertAccount("_test_handle", "테스트 계정");
    assert.equal(getAccount("_test_handle")?.label, "테스트 계정");

    updateLastSeen("_test_handle", "999");
    assert.equal(getAccount("_test_handle")?.last_seen_id, "999");
  });

  test("saveEvents: 게시물 하나에 이벤트 여러 건도 저장된다", () => {
    const bundle: ExtractedBundle = {
      source: "x",
      sourceId: "_test_post_1",
      url: "https://x.com/_test_handle/status/1",
      fetchedAt: new Date().toISOString(),
      postedAt: null,
      text: "",
      imagePaths: [],
      imageUrls: [],
      meta: { handle: "_test_handle" },
    };
    const data: EventExtraction = {
      events: [
        {
          kind: "커튼콜",
          title: "스페셜 커튼콜",
          showName: null,
          date: "2026-09-20",
          time: "15:00",
          description: "d1",
          confidence: 0.9,
        },
        {
          kind: "할인",
          title: "조기예매 할인",
          showName: null,
          date: null,
          time: null,
          description: "d2",
          confidence: 0.7,
        },
      ],
      warnings: [],
    };

    const { saved } = saveEvents("_test_handle", [wrap(bundle, data)]);
    assert.equal(saved, 2);

    const rows = db()
      .prepare(`SELECT title, kind, date FROM events WHERE post_id = ? ORDER BY title`)
      .all("_test_post_1") as { title: string; kind: string; date: string | null }[];
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.title === "스페셜 커튼콜" && r.date === "2026-09-20"));
  });
});
