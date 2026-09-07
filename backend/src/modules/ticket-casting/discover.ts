/**
 * 모듈 2-1 (Discover) — KOPIS 공연을 예매처 상세페이지 URL로 잇는다.
 *
 * KOPIS는 공연ID(mt20id)만 주고 예매처 링크를 주지 않는다. 그래서 공연명으로 검색해서
 * 상세페이지를 찾아내야 하는데, 이게 이 모듈에서 제일 부정확한 부분이다:
 *
 *   - 같은 작품이 지역/기간별로 여러 건 (`[서울]`, `[대구]`, 앙코르, 연장)
 *   - 예매처마다 제목 표기가 다름 (`뮤지컬 <지킬앤하이드>` vs `지킬앤하이드`)
 *   - 동명이작(리바이벌)
 *
 * 그래서 **자동 매칭을 신뢰하지 않는다.** 점수가 임계값 미만이면 null을 돌려주고
 * 사람이 OVERRIDES에 직접 넣게 한다. 잘못 이은 상세페이지에서 캐스팅을 긁어오면
 * 다른 공연의 캐스팅이 DB에 들어가는데, 이건 아무것도 없는 것보다 나쁘다.
 *
 * ⚠️ 미조사: SEARCH의 URL 템플릿·셀렉터는 전부 추정값이다.
 *    사용자가 샘플 상세페이지 링크를 주면 그걸로 실물 구조를 맞춘다.
 */
import { chromium, type Browser } from "playwright";
import type { SourceKind } from "../../shared/etl.ts";
import { politeSleep } from "../../shared/sleep.ts";
import * as log from "../../shared/log.ts";

export type TicketSite = Extract<SourceKind, "interpark" | "yes24" | "melon">;

interface SearchConfig {
  label: string;
  /** {q} 자리에 URL 인코딩된 공연명이 들어간다. TODO: 실물 확인 */
  searchUrl: string;
  /** 검색 결과 한 건 */
  itemSelector: string;
  /** 결과 안의 제목 */
  titleSelector: string;
  /** 결과 안의 상세페이지 링크 */
  linkSelector: string;
}

/** ⚠️ 전부 추정값. 샘플 링크를 받으면 교체할 것. */
export const SEARCH: Record<TicketSite, SearchConfig> = {
  interpark: {
    label: "인터파크(NOL)",
    searchUrl: "https://tickets.interpark.com/search?keyword={q}",
    itemSelector: "[class*=searchList] li",
    titleSelector: "[class*=title]",
    linkSelector: "a[href*='/goods/']",
  },
  yes24: {
    label: "예스24 티켓",
    searchUrl: "http://ticket.yes24.com/Search/Search?keyword={q}",
    itemSelector: ".search-list li",
    titleSelector: ".tit",
    linkSelector: "a[href*='Perf/']",
  },
  melon: {
    label: "멜론티켓",
    searchUrl: "https://ticket.melon.com/search/total/index.htm?searchKeyword={q}",
    itemSelector: ".list_ticket li",
    titleSelector: ".tit",
    linkSelector: "a[href*='prodId=']",
  },
};

/**
 * 자동 매칭이 실패했거나 틀렸을 때 사람이 직접 박아 넣는 곳.
 * KOPIS 공연ID → 예매처 상세페이지 URL. 자동 결과보다 항상 우선한다.
 */
export const OVERRIDES: Record<string, { site: TicketSite; url: string }> = {
  // "PF132236": { site: "interpark", url: "https://tickets.interpark.com/goods/..." },
};

/** 이 점수 미만이면 매칭 실패로 본다. 억지로 잇느니 비워 두는 게 낫다. */
export const MATCH_THRESHOLD = 0.6;

export interface DiscoverResult {
  showId: string;
  site: TicketSite;
  url: string;
  matchedTitle: string;
  score: number;
  /** OVERRIDES에서 나왔으면 true — 사람이 확인한 것이므로 그대로 믿는다. */
  manual: boolean;
}

/**
 * 제목 정규화. 매칭 점수를 재기 전에 양쪽을 같은 모양으로 만든다.
 *   "뮤지컬 <지킬 앤 하이드> [서울]" → "지킬앤하이드"
 */
export function normalizeTitle(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ") // [서울], [앙코르]
    .replace(/\([^)]*\)/g, " ") // (재공연)
    .replace(/[<>《》〈〉'"'"]/g, " ")
    .replace(/^(뮤지컬|연극|오페라|콘서트)\s*/g, " ")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

/** 문자 바이그램 자카드 유사도. 한국어 제목에는 형태소 분석보다 이쪽이 무난하다. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const grams = (s: string) => {
    const set = new Set<string>();
    if (s.length === 1) set.add(s);
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };

  const ga = grams(na);
  const gb = grams(nb);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

/**
 * 공연명으로 예매처를 검색해 상세페이지 URL을 찾는다.
 * 확신이 없으면 null. 그 경우 OVERRIDES에 손으로 넣어야 한다.
 */
export async function findDetailUrl(opts: {
  showId: string;
  showName: string;
  sites?: TicketSite[];
  browser?: Browser;
}): Promise<DiscoverResult | null> {
  const manual = OVERRIDES[opts.showId];
  if (manual) {
    return {
      showId: opts.showId,
      site: manual.site,
      url: manual.url,
      matchedTitle: opts.showName,
      score: 1,
      manual: true,
    };
  }

  const sites = opts.sites ?? (["interpark", "yes24", "melon"] as TicketSite[]);
  const own = !opts.browser;
  const browser =
    opts.browser ?? (await chromium.launch({ headless: process.env.HEADFUL !== "1" }));

  try {
    let best: DiscoverResult | null = null;

    for (const site of sites) {
      const cfg = SEARCH[site];
      const page = await browser.newPage({ locale: "ko-KR" });

      try {
        await page.goto(cfg.searchUrl.replace("{q}", encodeURIComponent(opts.showName)), {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });

        const items = page.locator(cfg.itemSelector);
        const n = Math.min(await items.count(), 20);

        for (let i = 0; i < n; i++) {
          const item = items.nth(i);
          const title = (await item.locator(cfg.titleSelector).first().innerText().catch(() => "")).trim();
          const href = await item.locator(cfg.linkSelector).first().getAttribute("href").catch(() => null);
          if (!title || !href) continue;

          const score = titleSimilarity(opts.showName, title);
          if (!best || score > best.score) {
            best = {
              showId: opts.showId,
              site,
              url: new URL(href, cfg.searchUrl).toString(),
              matchedTitle: title,
              score,
              manual: false,
            };
          }
        }
      } finally {
        await page.close();
        await politeSleep();
      }
    }

    if (!best || best.score < MATCH_THRESHOLD) {
      log.warn(
        "ticket-casting",
        `"${opts.showName}" 상세페이지를 찾지 못했습니다 (최고점 ${best?.score.toFixed(2) ?? "-"}). OVERRIDES에 직접 넣으세요.`,
      );
      return null;
    }

    log.info(
      "ticket-casting",
      `"${opts.showName}" → ${SEARCH[best.site].label} "${best.matchedTitle}" (${best.score.toFixed(2)})`,
    );
    return best;
  } finally {
    if (own) await browser.close();
  }
}
