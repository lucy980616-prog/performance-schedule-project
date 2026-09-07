/**
 * 모듈 2-1 (Extract) — NOL(인터파크).
 *
 * 이 프로젝트에서 가장 좋은 소스다. **회차별 캐스팅이 이미 구조화 JSON**으로 오고,
 * **공연 발견(장르별 목록)까지 구조화 JSON**으로 온다. 둘 다 브라우저 없이 GET 한 번.
 * KOPIS가 막힌 지금, 발견(discovery) 축을 이 모듈이 대신한다 (→ discover.ts 아님, 이 파일).
 *
 * 2026-09-07 실측 (뮤지컬 웨스턴 스토리 goodsCode=26007505):
 *
 * ① 발견 — 장르별 목록 페이지 (콘서트 등은 URL 자체가 갈리므로 자동으로 제외된다)
 *
 *   GET https://nol.yanolja.com/ticket/genre/musical   (또는 /play)
 *
 *   순수 SSR HTML이라 브라우저 없이 curl만으로 된다. Next.js가 페이지 안에
 *   `self.__next_f.push([1,"..."])` 조각들로 React Query의 dehydrated state를 심어 두는데,
 *   그 안에 목록 위젯 데이터가 그대로 들어 있다 — 항목마다
 *   `"id":"{goodsCode}:{placeCode}"`(캐스팅 API에 바로 쓸 수 있는 goodsKey 그 자체),
 *   `"title"`, `"dateInfo"`, `"locationDetails"` 가 있다. 1페이지 GET에서 46건 확인.
 *   ⚠️ 무한스크롤 다음 페이지를 부르는 별도 API는 못 찾았다 — 지금은 1페이지(대량 위젯 합산)만 쓴다.
 *
 * ② 상세 — 상세페이지 HTML에도 같은 goodsKey가 박혀 있다 (`26007505:25001547` 그대로 텍스트로 존재)
 *
 *   GET https://nol.yanolja.com/ticket/products/{goodsCode}
 *
 *   JSON-LD(`@type:Product`)에 name/price/image/description은 있지만 기간·출연진은 없다.
 *   그건 아래 캐스팅 API가 채운다.
 *
 * ③ 회차별 캐스팅 — 완전히 구조화되어 있어 AI 판독이 필요 없다
 *
 *   GET .../api/casting-min-max?goodsKey=...&type=castingSchedule   → 조회 가능 기간
 *   GET .../api/casting-schedule?goodsKey=...&startDate=...&endDate=...&minPlayDate=...&maxPlayDate=...
 *     → { content: [{ playDate, playTime, castingList: [{characterName, manName, ...}] }] }
 *
 *   여기서 바로 CastingExtraction(zod 검증 완료)을 만든다. 2-2(claude -p)를 거치지 않는다 —
 *   오독 위험이 없는 데이터를 굳이 AI에 보낼 이유가 없다.
 */
import { CastingExtraction, type ExtractContext } from "./schema.ts";
import { type ExtractedBundle } from "../../shared/etl.ts";
import { politeSleep } from "../../shared/sleep.ts";
import * as log from "../../shared/log.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export type NolGenre = "musical" | "play";

// ── ① 발견 ────────────────────────────────────────────────────────────

export interface NolListItem {
  goodsCode: string;
  placeCode: string;
  goodsKey: string; // `${goodsCode}:${placeCode}`
  title: string;
  dateInfo: string; // "26.09.15 ~ 26.12.06" 같은 원문. 파싱은 상세 조회에서 다시 한다.
  venue: string;
  url: string;
}

/**
 * 장르 목록 페이지 HTML에서 `self.__next_f.push([1,"..."])` 안의 항목들을 뽑는다.
 * Next.js가 문자열을 JSON-escape해서 심어 두므로(`\"`), 패턴은 이스케이프된 채로 찾는다.
 */
export function parseGenreListing(html: string, genre: NolGenre): NolListItem[] {
  const chunkRe = /self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs;
  const items = new Map<string, NolListItem>();

  for (const m of html.matchAll(chunkRe)) {
    const raw = m[1]!;
    // "id":"26010918:26000902", ... "title":"...", "locationDetails":["..."], "dateInfo":"..."
    const itemRe =
      /\\"id\\":\\"(\d+):(\d+)\\".*?\\"title\\":\\"((?:[^"\\]|\\.)*?)\\"/gs;
    for (const im of raw.matchAll(itemRe)) {
      const [, goodsCode, placeCode, titleEsc] = im;
      if (!goodsCode || !placeCode || !titleEsc) continue;
      const goodsKey = `${goodsCode}:${placeCode}`;
      if (items.has(goodsKey)) continue;

      // title 뒤 근방에서 dateInfo/locationDetails를 찾는다 (없을 수 있다 — 위젯마다 필드가 다르다).
      const tail = raw.slice(im.index ?? 0, (im.index ?? 0) + 600);
      const dateInfo = /\\"dateInfo\\":\\"((?:[^"\\]|\\.)*?)\\"/.exec(tail)?.[1] ?? "";
      const venue = /\\"locationDetails\\":\[\\"((?:[^"\\]|\\.)*?)\\"/.exec(tail)?.[1] ?? "";

      items.set(goodsKey, {
        goodsCode,
        placeCode,
        goodsKey,
        title: unescapeJs(titleEsc),
        dateInfo: unescapeJs(dateInfo),
        venue: unescapeJs(venue),
        url: `https://nol.yanolja.com/ticket/places/${placeCode}/products/${goodsCode}`,
      });
    }
  }

  if (items.size === 0) {
    // 조용히 빈 목록을 돌려주지 않는다. Next.js 빌드 구조가 바뀌면 이 파서가 제일 먼저 깨진다.
    throw new Error(
      `NOL 장르 목록(${genre})에서 항목을 하나도 못 찾았습니다. 페이지 구조가 바뀌었을 수 있습니다.`,
    );
  }

  return [...items.values()];
}

export async function fetchGenreListing(genre: NolGenre): Promise<NolListItem[]> {
  const res = await fetch(`https://nol.yanolja.com/ticket/genre/${genre}`, {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
  });
  if (!res.ok) throw new Error(`NOL 장르 목록(${genre}) HTTP ${res.status}`);

  const items = parseGenreListing(await res.text(), genre);
  log.info("ticket-casting", `NOL ${genre} 장르 목록 ${items.length}건`);
  await politeSleep();
  return items;
}

function unescapeJs(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

// ── ② 상세: goodsKey 확보 ────────────────────────────────────────────

/** 상세페이지 HTML에서 `{goodsCode}:{placeCode}` 를 찾는다. 목록에서 이미 알면 이 단계는 건너뛴다. */
export function parseGoodsKey(html: string, goodsCode: string): string {
  const re = new RegExp(`${goodsCode}[:%]{1,3}(?:3A)?(\\d{6,9})`);
  const m = re.exec(html);
  if (!m?.[1]) {
    throw new Error(
      `NOL ${goodsCode}: goodsKey(placeCode)를 상세페이지에서 찾지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다.`,
    );
  }
  return `${goodsCode}:${m[1]}`;
}

export async function fetchGoodsKey(goodsCode: string): Promise<string> {
  const res = await fetch(`https://nol.yanolja.com/ticket/products/${goodsCode}`, {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
  });
  if (!res.ok) throw new Error(`NOL ${goodsCode} 상세페이지 HTTP ${res.status}`);
  const goodsKey = parseGoodsKey(await res.text(), goodsCode);
  await politeSleep();
  return goodsKey;
}

export interface NolShowSummary {
  goodsCode: string;
  placeCode: string;
  goodsKey: string;
  name: string;
  price: number | null;
  poster: string;
  url: string;
}

/** 상세페이지 JSON-LD(`@type:Product`)에서 name/price/image를 읽는다. 기간·출연진은 없다. */
export function parseProductLd(html: string): { name: string; price: number | null; poster: string } {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const b of blocks) {
    let node: { "@type"?: string; name?: string; offers?: { price?: number | string }; image?: string | string[] };
    try {
      node = JSON.parse(b[1]!);
    } catch {
      continue;
    }
    if (node["@type"] !== "Product") continue;
    const image = Array.isArray(node.image) ? node.image[0] : node.image;
    return {
      name: unescapeHtml(node.name ?? ""),
      price: node.offers?.price !== undefined ? Number(node.offers.price) || null : null,
      poster: image ?? "",
    };
  }
  return { name: "", price: null, poster: "" };
}

/** 상세페이지를 한 번만 fetch해서 goodsKey와 기본 정보를 같이 얻는다. */
export async function fetchShowSummary(goodsCode: string): Promise<NolShowSummary> {
  const url = `https://nol.yanolja.com/ticket/products/${goodsCode}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
  });
  if (!res.ok) throw new Error(`NOL ${goodsCode} 상세페이지 HTTP ${res.status}`);

  const html = await res.text();
  const goodsKey = parseGoodsKey(html, goodsCode);
  const ld = parseProductLd(html);
  await politeSleep();

  return {
    goodsCode,
    placeCode: goodsKey.split(":")[1]!,
    goodsKey,
    name: ld.name,
    price: ld.price,
    poster: ld.poster,
    url,
  };
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// ── ③ 회차별 캐스팅 — 구조화 JSON, AI 판독 불필요 ─────────────────────

export interface NolCastingRange {
  goodsKey: string;
  minPlayDate: string;
  maxPlayDate: string;
}

export interface NolCastingEntry {
  playSeq: string;
  playDate: string; // YYYY-MM-DD
  playTime: string; // HH:MM
  dayOfWeek: string;
  castingList: { characterName: string; manName: string }[];
}

function refererFor(goodsCode: string) {
  return `https://nol.yanolja.com/ticket/products/${goodsCode}`;
}

export async function fetchCastingRange(goodsKey: string): Promise<NolCastingRange> {
  const goodsCode = goodsKey.split(":")[0]!;
  const url = `https://nol.yanolja.com/ticket/products/api/casting-min-max?goodsKey=${encodeURIComponent(goodsKey)}&type=castingSchedule`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: refererFor(goodsCode) },
  });
  if (!res.ok) throw new Error(`NOL ${goodsKey} casting-min-max HTTP ${res.status}`);
  const json = (await res.json()) as { minPlayDate?: string; maxPlayDate?: string };
  if (!json.minPlayDate || !json.maxPlayDate) {
    throw new Error(`NOL ${goodsKey}: 캐스팅 조회 가능 기간이 없습니다. 회차가 없는 공연일 수 있습니다.`);
  }
  await politeSleep();
  return { goodsKey, minPlayDate: json.minPlayDate, maxPlayDate: json.maxPlayDate };
}

export async function fetchCastingSchedule(opts: {
  goodsKey: string;
  startDate: string;
  endDate: string;
  minPlayDate: string;
  maxPlayDate: string;
}): Promise<NolCastingEntry[]> {
  const goodsCode = opts.goodsKey.split(":")[0]!;
  const qs = new URLSearchParams({
    goodsKey: opts.goodsKey,
    startDate: opts.startDate,
    endDate: opts.endDate,
    minPlayDate: opts.minPlayDate,
    maxPlayDate: opts.maxPlayDate,
  });
  const res = await fetch(
    `https://nol.yanolja.com/ticket/products/api/casting-schedule?${qs}`,
    { headers: { "User-Agent": UA, Referer: refererFor(goodsCode) } },
  );
  if (!res.ok) throw new Error(`NOL ${opts.goodsKey} casting-schedule HTTP ${res.status}`);

  const json = (await res.json()) as { content?: NolCastingEntry[] };
  const content = json.content ?? [];
  if (content.length === 0) {
    throw new Error(`NOL ${opts.goodsKey}: 회차가 0건입니다. 기간 파라미터를 확인하세요.`);
  }
  log.info("ticket-casting", `NOL ${opts.goodsKey} 회차 ${content.length}건 (구조화 API, AI 판독 불필요)`);
  await politeSleep();
  return content;
}

/** 조회 가능 기간 전체를 자동으로 훑어 회차별 캐스팅을 가져온다. */
export async function fetchAllCasting(goodsKey: string): Promise<NolCastingEntry[]> {
  const range = await fetchCastingRange(goodsKey);
  return fetchCastingSchedule({
    goodsKey,
    startDate: range.minPlayDate,
    endDate: range.maxPlayDate,
    minPlayDate: range.minPlayDate,
    maxPlayDate: range.maxPlayDate,
  });
}

/**
 * 구조화 데이터를 프로젝트 공통 CastingExtraction으로 바꾼다.
 * claude -p를 거치지 않으므로 warnings는 항상 빈 배열이다.
 */
export function toCastingExtraction(entries: NolCastingEntry[]): CastingExtraction {
  const roleMap = new Map<string, Set<string>>();

  const castingEntries = entries.map((e) => {
    const actors: string[] = [];
    for (const c of e.castingList) {
      actors.push(c.manName);
      if (!roleMap.has(c.characterName)) roleMap.set(c.characterName, new Set());
      roleMap.get(c.characterName)!.add(c.manName);
    }
    return { date: e.playDate, time: e.playTime, actors, note: null };
  });

  const roles = [...roleMap.entries()].map(([role, actors]) => ({
    role,
    actors: [...actors],
  }));

  const result = { entries: castingEntries, roles, warnings: [] };
  const parsed = CastingExtraction.safeParse(result);
  if (!parsed.success) {
    // NOL 응답 필드가 바뀌었다는 뜻이다. 형식이 안 맞는 걸 조용히 흘려보내지 않는다.
    throw new Error(`NOL 캐스팅 데이터가 스키마와 맞지 않습니다: ${parsed.error.message}`);
  }
  return parsed.data;
}

// ── ExtractedBundle 변환 (추적성 유지용) ────────────────────────────

export function toBundle(item: Pick<NolListItem, "goodsKey" | "title" | "url">): ExtractedBundle {
  return {
    source: "nol",
    sourceId: item.goodsKey,
    url: item.url,
    fetchedAt: new Date().toISOString(),
    postedAt: null,
    text: `공연명: ${item.title}`,
    imagePaths: [],
    imageUrls: [],
    meta: { site: "nol", goodsKey: item.goodsKey, showName: item.title },
  };
}

export function contextFor(title: string, startDate: string, endDate: string): ExtractContext {
  return { showName: title, startDate, endDate };
}
