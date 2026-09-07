/**
 * 모듈 3-1 (폴백) — Playwright 비로그인 프로필 크롤링.
 *
 * 신디케이션(syndication.ts)이 막혔을 때만 쓴다. 실측상 이쪽이 명백히 열세다:
 *   게시물 6건 (스크롤 불가) / 본문 텍스트가 data-testid="tweetText" 로 안 잡힘 / 브라우저 필요
 *
 * ⚠️ x.com robots.txt 는 일반 크롤러를 금지하고 Crawl-delay: 1 을 둔다.
 *    개인용이라도 계정 간 3초 이상, 하루 1회, 순차 처리를 지킨다.
 */
import { chromium, type Browser } from "playwright";
import type { ExtractedBundle } from "../../shared/etl.ts";
import { politeSleep } from "../../shared/sleep.ts";
import * as log from "../../shared/log.ts";

/** 본문 셀렉터 후보. 위에서부터 먼저 잡히는 것을 쓴다. 실물 확인 후 정리할 것. */
const TEXT_SELECTORS = ['[data-testid="tweetText"]', "div[lang]", 'article div[dir="auto"]'];

export async function scrapeProfile(opts: {
  handle: string;
  sinceId?: string;
  limit?: number;
  browser?: Browser;
}): Promise<ExtractedBundle[]> {
  const handle = opts.handle.replace(/^@/, "");
  const own = !opts.browser;
  const browser =
    opts.browser ?? (await chromium.launch({ headless: process.env.HEADFUL !== "1" }));

  try {
    const page = await browser.newPage({
      locale: "ko-KR",
      viewport: { width: 1280, height: 2000 },
    });

    await page.goto(`https://x.com/${handle}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForSelector("article", { timeout: 30_000 }).catch(() => null);

    const articles = page.locator("article");
    const count = Math.min(await articles.count(), opts.limit ?? 6);

    if (count === 0) {
      // 조용한 빈 결과 금지. DOM이 바뀌었거나 차단당한 것이다.
      throw new Error(
        `@${handle}: article 요소를 하나도 찾지 못했습니다. X DOM 변경 또는 IP 차단을 의심하세요.`,
      );
    }

    const fetchedAt = new Date().toISOString();
    const bundles: ExtractedBundle[] = [];

    for (let i = 0; i < count; i++) {
      const a = articles.nth(i);

      const href = await a
        .locator(`a[href*="/${handle}/status/"]`)
        .first()
        .getAttribute("href")
        .catch(() => null);
      const id = href?.match(/\/status\/(\d+)/)?.[1];
      if (!id) continue;
      if (opts.sinceId && BigInt(id) <= BigInt(opts.sinceId)) continue;

      let text = "";
      for (const sel of TEXT_SELECTORS) {
        const loc = a.locator(sel).first();
        if ((await loc.count()) > 0) {
          text = (await loc.innerText().catch(() => "")).trim();
          if (text) break;
        }
      }

      const imageUrls = (
        await a
          .locator('img[src*="pbs.twimg.com/media/"]')
          .evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src))
      ).map((u) => u.replace(/name=\w+/, "name=large"));

      const postedAt = await a
        .locator("time")
        .first()
        .getAttribute("datetime")
        .catch(() => null);

      bundles.push({
        source: "x",
        sourceId: id,
        url: `https://x.com/${handle}/status/${id}`,
        fetchedAt,
        postedAt,
        text,
        imagePaths: [],
        imageUrls,
        meta: { handle, via: "playwright" },
      });
    }

    if (bundles.length > 0 && bundles.every((b) => b.text === "")) {
      log.warn(
        "x-events",
        `@${handle}: 본문을 하나도 못 읽었습니다. TEXT_SELECTORS 재조사 필요`,
      );
    }

    log.info("x-events", `@${handle} Playwright 새 게시물 ${bundles.length}건`);
    await page.close();
    await politeSleep();
    return bundles;
  } finally {
    if (own) await browser.close();
  }
}
