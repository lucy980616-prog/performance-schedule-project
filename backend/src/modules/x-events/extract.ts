/**
 * 모듈 3-1 (Extract) — 추적 계정의 **새** 게시물만 긁어온다.
 *
 * 경로가 둘이다:
 *   주 경로  syndication.ts  — 로그인·브라우저 없이 GET 한 번. 100건, 본문 완전.
 *   폴백    playwright.ts   — 신디케이션이 막히면. 6건, 본문이 안 잡힐 수 있음.
 *
 * 여기서 AI는 쓰지 않는다. 판독은 전부 3-2(transform.ts)의 몫이다.
 */
import fs from "node:fs";
import type { ExtractedBundle } from "../../shared/etl.ts";
import { writeTmp } from "../../shared/tmp.ts";
import { politeSleep } from "../../shared/sleep.ts";
import * as log from "../../shared/log.ts";
import {
  fetchTimeline,
  SyndicationEmptyError,
  SyndicationRateLimitError,
} from "./syndication.ts";
import { scrapeProfile } from "./playwright.ts";

export interface CollectOptions {
  handle: string;
  /** 마지막으로 본 status ID. 이보다 새 것만 가져온다. */
  sinceId?: string;
  limit?: number;
  /** 신디케이션이 실패하면 Playwright로 넘어간다. 기본 true */
  allowFallback?: boolean;
  /** 이미지를 로컬로 받아 imagePaths를 채운다. 기본 true */
  downloadImages?: boolean;
}

export async function collectAccount(opts: CollectOptions): Promise<ExtractedBundle[]> {
  let bundles: ExtractedBundle[];

  try {
    bundles = await fetchTimeline({
      handle: opts.handle,
      sinceId: opts.sinceId,
      limit: opts.limit,
    });
  } catch (err) {
    // 429(레이트 리밋)도 폴백 대상이다. 즉시 재시도 대신 Playwright로 한 번만 우회한다.
    const recoverable =
      err instanceof SyndicationEmptyError ||
      err instanceof SyndicationRateLimitError ||
      err instanceof TypeError;
    if (!(opts.allowFallback ?? true) || !recoverable) throw err;

    log.warn(
      "x-events",
      `@${opts.handle}: 신디케이션 실패 → Playwright 폴백`,
      err instanceof Error ? err.message : err,
    );
    bundles = await scrapeProfile({
      handle: opts.handle,
      sinceId: opts.sinceId,
      limit: opts.limit,
    });
  }

  if (opts.downloadImages ?? true) {
    for (const b of bundles) {
      b.imagePaths = await downloadImages(b);
      await politeSleep();
    }
  }

  return bundles;
}

/** 이미지 URL을 로컬 파일로 받아 경로를 돌려준다. 3-2가 이 경로를 Read 툴로 읽는다. */
export async function downloadImages(bundle: ExtractedBundle): Promise<string[]> {
  const paths: string[] = [];

  for (const [i, url] of bundle.imageUrls.entries()) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        log.warn("x-events", `이미지 ${res.status}`, url);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      paths.push(writeTmp(`x-${bundle.sourceId}-${i}.jpg`, buf));
    } catch (err) {
      log.warn("x-events", "이미지 다운로드 실패", err instanceof Error ? err.message : err);
    }
  }

  return paths;
}

/** 판독이 끝난 뒤 임시 이미지를 지운다. */
export function discardImages(bundles: ExtractedBundle[]) {
  for (const b of bundles) {
    for (const p of b.imagePaths) {
      try {
        fs.unlinkSync(p);
      } catch {
        // 이미 지워졌으면 그만이다.
      }
    }
    b.imagePaths = [];
  }
}
