/**
 * 모듈 2-1 (Extract) — 예매처 상세페이지에서 캐스팅 정보를 **원본 그대로** 확보한다.
 *
 * 여기서는 판독하지 않는다. 이미지와 텍스트를 모아 ExtractedBundle로 만들어 두는 게 전부다.
 * 판독은 2-2(transform.ts)의 몫이다.
 *
 * 캐스팅표는 사이트마다 형태가 다르다:
 *   (a) 상세 설명 안에 통이미지 한 장 — 제일 흔하다. 이미지를 받아서 넘긴다.
 *   (b) HTML 표 — 텍스트로 긁으면 되고 판독도 정확하다. 우선한다.
 *   (c) 캘린더 위젯 — 스크린샷을 떠서 넘긴다.
 * 셋 다 모아 두고, 판독 단계에서 텍스트가 충분하면 텍스트를, 아니면 이미지를 쓴다.
 *
 * ⚠️ 미조사: DETAIL의 셀렉터는 전부 추정값이다. 샘플 상세페이지 링크를 받으면 실물로 맞춘다.
 *    HEADFUL=1 로 띄워서 확인할 것.
 * ⚠️ 티켓링크는 제외한다 — 접속 즉시 "비정상 활동 감지" 경고가 뜨는 것을 실측 확인했다.
 */
import { chromium, type Browser, type Page } from "playwright";
import type { ExtractedBundle } from "../../shared/etl.ts";
import { writeTmp } from "../../shared/tmp.ts";
import { politeSleep } from "../../shared/sleep.ts";
import * as log from "../../shared/log.ts";
import type { TicketSite } from "./discover.ts";

interface DetailConfig {
  label: string;
  /** 캐스팅표가 들어 있는 컨테이너. TODO: 실물 확인 필요 */
  castingSelector: string;
  /** 상세 설명이 lazy-load라 스크롤이 필요한지 */
  needsScroll: boolean;
}

/** ⚠️ 전부 추정값. 샘플 링크를 받으면 교체할 것. */
export const DETAIL: Record<TicketSite, DetailConfig> = {
  interpark: { label: "인터파크(NOL)", castingSelector: "#productMainWrap", needsScroll: true },
  yes24: { label: "예스24 티켓", castingSelector: ".rn-context", needsScroll: true },
  melon: { label: "멜론티켓", castingSelector: "#detailView", needsScroll: true },
};

export interface CaptureOptions {
  url: string;
  site: TicketSite;
  /** KOPIS 공연ID. meta에 넣어 두면 판독 결과를 공연에 다시 잇기 쉽다. */
  showId?: string;
  showName?: string;
  browser?: Browser;
  /** 컨테이너 안의 <img>를 받아 온다. 캐스팅표가 통이미지인 경우 이게 본체다. */
  downloadImages?: boolean;
}

export async function captureDetail(opts: CaptureOptions): Promise<ExtractedBundle> {
  const cfg = DETAIL[opts.site];
  const own = !opts.browser;
  const browser =
    opts.browser ?? (await chromium.launch({ headless: process.env.HEADFUL !== "1" }));

  try {
    const page = await browser.newPage({
      locale: "ko-KR",
      viewport: { width: 1280, height: 1600 },
    });

    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (cfg.needsScroll) await autoScroll(page);

    const container = page.locator(cfg.castingSelector).first();
    if ((await container.count()) === 0) {
      // 조용히 빈 결과를 돌려주지 않는다. 셀렉터가 깨진 것이므로 즉시 알린다.
      throw new Error(
        `${cfg.label} 캐스팅 컨테이너(${cfg.castingSelector})를 찾지 못했습니다. 셀렉터를 다시 조사하세요.`,
      );
    }

    const stamp = `${opts.site}-${opts.showId ?? Date.now()}`;
    const text = (await container.innerText().catch(() => "")).trim();

    // (c) 컨테이너 전체 스크린샷 — 캘린더 위젯이나 표 형태를 통째로 남긴다.
    const imagePaths = [
      writeTmp(`${stamp}-page.png`, await container.screenshot({ type: "png" })),
    ];

    // (a) 상세 설명 안의 통이미지 — 캐스팅표는 대개 이 안에 있다.
    const imageUrls = await container
      .locator("img")
      .evaluateAll((els) =>
        els
          .map((e) => (e as HTMLImageElement).currentSrc || (e as HTMLImageElement).src)
          .filter((u) => u && !u.startsWith("data:")),
      )
      .catch(() => [] as string[]);

    if (opts.downloadImages ?? true) {
      for (const [i, url] of imageUrls.entries()) {
        const buf = await download(url);
        if (buf) imagePaths.push(writeTmp(`${stamp}-${i}${extOf(url)}`, buf));
      }
    }

    log.info("ticket-casting", `${cfg.label} 수집 완료`, {
      url: opts.url,
      text: text.length,
      images: imagePaths.length,
    });

    await page.close();
    await politeSleep();

    return {
      source: opts.site,
      sourceId: opts.showId ?? opts.url,
      url: opts.url,
      fetchedAt: new Date().toISOString(),
      postedAt: null,
      text,
      imagePaths,
      imageUrls,
      meta: {
        site: opts.site,
        ...(opts.showId ? { showId: opts.showId } : {}),
        ...(opts.showName ? { showName: opts.showName } : {}),
      },
    };
  } finally {
    if (own) await browser.close();
  }
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn("ticket-casting", `이미지 ${res.status}`, url);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    log.warn("ticket-casting", "이미지 다운로드 실패", err instanceof Error ? err.message : err);
    return null;
  }
}

function extOf(url: string): string {
  const m = /\.(png|jpe?g|webp|gif)(?:$|\?)/i.exec(url);
  return m?.[1] ? `.${m[1].toLowerCase()}` : ".png";
}

async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let y = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 600);
        y += 600;
        if (y >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  await page.waitForTimeout(500);
}
