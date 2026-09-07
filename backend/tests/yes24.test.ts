import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseShow,
  parsePerfContents,
  extractCastingImageUrls,
  fetchShow,
  fetchCastingImageUrls,
} from "../src/modules/ticket-casting/yes24.ts";

const NO_LIVE = process.env.RUN_LIVE !== "1";

/** 2026-09-07 실측(뮤지컬 곤 투모로우 idPerf=59596)과 동일한 형태의 JSON-LD. */
function fakeDetailHtml(names: string[]): string {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: "뮤지컬 [곤 투모로우] 10주년 기념 공연",
    startDate: "2026-09-15",
    endDate: "2026-11-29",
    location: {
      "@type": "Place",
      name: "홍익대 대학로 아트센터 대극장",
      address: { "@type": "PostalAddress", streetAddress: "서울 종로구 대학로" },
    },
    offers: { price: "60000", priceCurrency: "KRW" },
    organizer: { name: "(주)쇼노트" },
    performer: { "@type": "Person", name: names },
    image: "//tkfile.yes24.com/poster/59596.jpg",
    description: "설명",
  };
  return `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head></html>`;
}

describe("ticket-casting / yes24 — parseShow (JSON-LD)", () => {
  const names = ["강필석", "최재웅", "김경수"];
  const html = fakeDetailHtml(names);

  test("Event JSON-LD 필드를 읽는다", () => {
    const show = parseShow(html, "59596");
    assert.match(show.name, /곤 투모로우/);
    assert.equal(show.startDate, "2026-09-15");
    assert.equal(show.endDate, "2026-11-29");
    assert.equal(show.venue, "홍익대 대학로 아트센터 대극장");
    assert.equal(show.price, 60000);
    assert.equal(show.organizer, "(주)쇼노트");
  });

  test("performer.name — 배열 형태를 처리한다 (티켓링크는 문자열이라 다르다)", () => {
    const show = parseShow(html, "59596");
    assert.deepEqual(show.cast, names);
  });

  test("프로토콜 상대 URL(//...)을 https로 정규화한다", () => {
    const show = parseShow(html, "59596");
    assert.equal(show.poster, "https://tkfile.yes24.com/poster/59596.jpg");
  });

  test("JSON-LD가 없으면 빈 값이 아니라 에러다", () => {
    assert.throws(() => parseShow("<html><body>차단됨</body></html>", "1"), /JSON-LD/);
  });
});

describe("ticket-casting / yes24 — parsePerfContents (CR/LF 내성 파싱)", () => {
  test("본문에 literal CR/LF가 있어도 파싱한다", () => {
    // 실제 응답은 JSON 문자열 값 안에 이스케이프 안 된 개행이 그대로 박혀 있다.
    const raw = `{"Result":"00","Msg":"성공.","PerfNotice":"line1\r\nline2","PerfCasting":"<p style=\\"text-align: left;\\"><img src=\\"https://tkfile.yes24.com/Upload2/Board/202608/20260826/59596_Sc.jpg\\"></p>"}`;
    const got = parsePerfContents(raw);
    assert.equal(got.Result, "00");
    assert.match(got.PerfCasting ?? "", /tkfile\.yes24\.com/);
  });

  test("순수 JSON(개행 없음)도 그대로 처리된다", () => {
    const got = parsePerfContents('{"Result":"00","PerfCasting":""}');
    assert.equal(got.PerfCasting, "");
  });
});

describe("ticket-casting / yes24 — extractCastingImageUrls", () => {
  test("<img src> 를 뽑는다", () => {
    const urls = extractCastingImageUrls(
      '<p style="text-align: left;"><img src="https://tkfile.yes24.com/Upload2/Board/202608/20260826/59596_Sc.jpg"></p>',
    );
    assert.deepEqual(urls, ["https://tkfile.yes24.com/Upload2/Board/202608/20260826/59596_Sc.jpg"]);
  });

  test("캐스팅표가 없으면(<p><br></p>) 빈 배열이다", () => {
    assert.deepEqual(extractCastingImageUrls("<p><br></p>"), []);
    assert.deepEqual(extractCastingImageUrls(""), []);
  });
});

describe("ticket-casting / yes24 — live", () => {
  const ID_PERF = "59596"; // 곤 투모로우

  test("실제 상세페이지를 읽는다", { skip: NO_LIVE, timeout: 60_000 }, async () => {
    const show = await fetchShow(ID_PERF);
    assert.match(show.name, /곤 투모로우/);
    assert.ok(show.cast.length > 5);
  });

  test("캐스팅표 이미지 URL을 얻는다", { skip: NO_LIVE, timeout: 60_000 }, async () => {
    const urls = await fetchCastingImageUrls(ID_PERF);
    assert.ok(urls.length > 0);
    assert.match(urls[0]!, /^https:\/\//);
  });
});
