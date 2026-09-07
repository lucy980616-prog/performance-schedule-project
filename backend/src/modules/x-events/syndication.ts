/**
 * 모듈 3-1 (주 경로) — X 신디케이션 타임라인.
 *
 * https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle}
 * 는 트윗 임베드용 공개 엔드포인트다. 로그인도 브라우저도 필요 없고, 응답 HTML의
 * __NEXT_DATA__ 안에 타임라인 JSON이 통째로 들어 있다.
 *
 * 2026-09-07 실측 (backend/README.md 참고):
 *   - @elonmusk  100건, 최신 2026-09-03  → 4일 지연. 캐시가 끼는 것으로 보인다.
 *   - @EMK_MUSICAL 100건, full_text·media·created_at 모두 정상
 *   - 없는 계정은 2KB짜리 빈 셸을 준다 (entries 0)
 *
 * Playwright 비로그인 방식(playwright.ts)과 비교하면:
 *   게시물 6건 → 100건 / 본문 못 읽음 → full_text 완전 / 브라우저 필요 → 단순 GET
 * 그래서 이쪽이 주 경로이고 Playwright는 폴백이다.
 *
 * ⚠️ Node 내장 fetch(undici)로는 무조건 429가 온다. 헤더 문제가 아니라 undici가 걸러진다.
 *    같은 IP에서 curl / node:http2 는 200이므로 shared/http.ts 의 http2Get 을 쓴다.
 *
 * ⚠️ 공식 문서가 없는 내부 엔드포인트다. 언제든 막힐 수 있으므로
 *    entries가 0이면 조용히 넘어가지 말고 폴백으로 넘긴다.
 */
import type { ExtractedBundle } from "../../shared/etl.ts";
import { http2GetText } from "../../shared/http.ts";
import * as log from "../../shared/log.ts";

const ENDPOINT = "https://syndication.twitter.com/srv/timeline-profile/screen-name";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

interface RawMedia {
  type?: string;
  media_url_https?: string;
}

interface RawTweet {
  id_str?: string;
  created_at?: string;
  full_text?: string;
  text?: string;
  user?: { screen_name?: string };
  entities?: { media?: RawMedia[] };
  extended_entities?: { media?: RawMedia[] };
  retweeted_status?: unknown;
}

export interface SyndicationOptions {
  handle: string;
  /** 이 status ID보다 큰 것만 (= 더 새 게시물만) 돌려준다. */
  sinceId?: string;
  /** 리트윗 제외. 기본 true — 남의 글까지 판독할 이유가 없다. */
  skipRetweets?: boolean;
  limit?: number;
}

export class SyndicationEmptyError extends Error {}

/**
 * 429. 2026-09-07 실측에서 연속 요청 5~6회 만에 걸렸다.
 * 즉시 재시도하지 않는다 — 다음 배치로 미룬다. (프로젝트 공통 원칙)
 */
export class SyndicationRateLimitError extends Error {
  readonly retryAfterSec?: number;

  constructor(handle: string, retryAfterSec?: number) {
    super(
      `@${handle}: 신디케이션 레이트 리밋(429).` +
        (retryAfterSec ? ` ${retryAfterSec}초 뒤 재시도 가능.` : " 다음 배치로 미루세요."),
    );
    this.name = "SyndicationRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

/** 신디케이션에서 게시물을 읽어 ExtractedBundle 목록으로 돌려준다. 이미지는 아직 안 받는다. */
export async function fetchTimeline(opts: SyndicationOptions): Promise<ExtractedBundle[]> {
  const handle = opts.handle.replace(/^@/, "");
  const res = await http2GetText(`${ENDPOINT}/${encodeURIComponent(handle)}`, {
    "user-agent": UA,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "ko-KR,ko;q=0.9",
  });

  if (res.status === 429) {
    const ra = Number(res.headers["retry-after"]);
    throw new SyndicationRateLimitError(handle, Number.isFinite(ra) ? ra : undefined);
  }
  if (res.status !== 200) {
    throw new Error(`@${handle}: 신디케이션 HTTP ${res.status}`);
  }

  const tweets = parseTimeline(res.text);
  if (tweets.length === 0) {
    // 계정이 없거나 보호계정이거나 엔드포인트가 막힌 것이다. 셋 다 조용히 넘어가면 안 된다.
    throw new SyndicationEmptyError(
      `@${handle}: 신디케이션에 게시물이 없습니다. 계정명/보호여부를 확인하거나 폴백을 쓰세요.`,
    );
  }

  const fetchedAt = new Date().toISOString();
  const bundles = tweets
    .filter((t) => (opts.skipRetweets ?? true ? !t.retweeted_status : true))
    .filter((t) => !opts.sinceId || BigInt(t.id_str!) > BigInt(opts.sinceId))
    .sort((a, b) => (BigInt(a.id_str!) < BigInt(b.id_str!) ? 1 : -1))
    .slice(0, opts.limit ?? 50)
    .map((t) => toBundle(t, handle, fetchedAt));

  log.info("x-events", `@${handle} 신디케이션 ${tweets.length}건 중 새 글 ${bundles.length}건`);
  return bundles;
}

/** 응답 HTML에서 타임라인 JSON을 꺼낸다. 파싱 실패를 빈 배열로 뭉개지 않는다. */
export function parseTimeline(html: string): RawTweet[] {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m?.[1]) {
    throw new Error("__NEXT_DATA__ 를 찾지 못했습니다. 신디케이션 응답 구조가 바뀌었습니다.");
  }

  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch (err) {
    throw new Error(`__NEXT_DATA__ JSON 파싱 실패: ${err instanceof Error ? err.message : err}`);
  }

  const entries =
    (data as { props?: { pageProps?: { timeline?: { entries?: unknown[] } } } })?.props?.pageProps
      ?.timeline?.entries ?? [];

  return entries
    .map((e) => (e as { type?: string; content?: { tweet?: RawTweet } }))
    .filter((e) => e.type === "tweet" && e.content?.tweet?.id_str)
    .map((e) => e.content!.tweet!);
}

function toBundle(t: RawTweet, handle: string, fetchedAt: string): ExtractedBundle {
  const media = t.extended_entities?.media ?? t.entities?.media ?? [];
  // 사진은 name=large 로 원본을 받고, 동영상은 썸네일만 쓴다.
  const imageUrls = media
    .map((m) => m.media_url_https)
    .filter((u): u is string => typeof u === "string")
    .map((u) => (u.includes("?") ? u : `${u}?name=large`));

  return {
    source: "x",
    sourceId: t.id_str!,
    url: `https://x.com/${handle}/status/${t.id_str}`,
    fetchedAt,
    postedAt: t.created_at ? new Date(t.created_at).toISOString() : null,
    text: t.full_text ?? t.text ?? "",
    imagePaths: [],
    imageUrls,
    meta: { handle, author: t.user?.screen_name ?? handle },
  };
}
