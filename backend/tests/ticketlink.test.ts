import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parseProduct,
  splitPerformers,
  toBundle,
  fetchProduct,
} from "../src/modules/ticket-casting/ticketlink.ts";

const FIXTURE = path.join(
  import.meta.dirname,
  "..",
  "fixtures",
  "ticket-casting",
  "ticketlink-65490.html",
);
const NO_LIVE = process.env.RUN_LIVE !== "1";

describe("ticket-casting / ticketlink (2-1)", () => {
  const html = fs.readFileSync(FIXTURE, "utf8");

  test("JSON-LD에서 공연 정보를 뽑는다", () => {
    const show = parseProduct(html, "65490");
    assert.match(show.name, /죽음에 관하여/);
    assert.equal(show.startDate, "2026-09-24");
    assert.equal(show.endDate, "2026-10-04");
    assert.equal(show.venue, "링크아트센터드림 드림3관");
    assert.equal(show.price, 66000);
    assert.equal(show.organizer, "주식회사 낭만바리케이트");
    assert.ok(show.poster.startsWith("https://"));
  });

  test("HTML 엔티티를 되돌린다", () => {
    // JSON-LD 안의 공연명은 &lt;죽음에 관하여&gt; 처럼 이스케이프되어 있다.
    const show = parseProduct(html, "65490");
    assert.ok(show.name.includes("<죽음에 관하여>"), show.name);
    assert.ok(!show.name.includes("&lt;"));
  });

  test("performer를 배우 목록으로 쪼갠다", () => {
    const show = parseProduct(html, "65490");
    const cast = splitPerformers(show.castRaw);
    assert.deepEqual(cast, ["성태준", "조성윤", "유승현", "강찬", "박좌헌", "신주협"]);
  });

  test("JSON-LD가 없으면 빈 값이 아니라 에러다", () => {
    // WAF에 막히면 JSON-LD 없는 셸이 온다. 조용히 넘어가면 데이터가 비어가는 걸 모른다.
    assert.throws(() => parseProduct("<html><body>차단</body></html>", "1"), /JSON-LD/);
  });

  test("toBundle: 회차 캐스팅 이미지는 비어 있다 (WAF로 못 가져옴)", () => {
    const b = toBundle(parseProduct(html, "65490"));
    assert.equal(b.source, "ticketlink");
    assert.equal(b.sourceId, "65490");
    assert.equal(b.imagePaths.length, 0);
    assert.match(b.text, /출연\(작품 전체\)/);
    assert.equal(b.meta.organizer, "주식회사 낭만바리케이트");
  });

  test(
    "live: 실제 상세페이지를 읽는다",
    { skip: NO_LIVE, timeout: 60_000 },
    async () => {
      const show = await fetchProduct("65165");
      assert.match(show.name, /렛미플라이/);
      assert.ok(splitPerformers(show.castRaw).length > 5);
    },
  );
});
