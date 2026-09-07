/**
 * 모듈 2-1 (Extract) — 예스24.
 *
 * 상세 정보는 JSON-LD로, 회차별 캐스팅은 이미지 한 장으로 온다. 이미지는 2-2(claude -p)가 판독한다.
 * ticketlink.ts와 형태는 비슷하지만, 예스24는 **캐스팅표 이미지 URL까지 얻는다**는 점이 다르다
 * (티켓링크는 WAF에 막혀 못 얻는다 — ticketlink.ts 상단 주석 참고).
 *
 * 2026-09-07 실측 (뮤지컬 곤 투모로우 idPerf=59596):
 *
 * ① 상세 — 정적 HTML, 브라우저 불필요
 *
 *   GET https://ticket.yes24.com/Perf/{idPerf}
 *
 *   JSON-LD(`@type:Event`)에 name/startDate/endDate/location/offers.price/organizer가 있고,
 *   `performer.name`은 **배열**이다 (티켓링크는 문자열 — 사이트마다 다르니 주의).
 *   실측: 18명 전체 출연진.
 *
 * ② 캐스팅표 이미지
 *
 *   GET https://ticket.yes24.com/New/Perf/Detail/Ajax/axPerfContents.aspx?IdPerf={idPerf}
 *     Referer: https://ticket.yes24.com/Perf/{idPerf}
 *     X-Requested-With: XMLHttpRequest
 *
 *   Content-Type은 text/html인데 본문은 JSON이다. **본문에 리터럴 CR/LF가 그대로 박혀 있어서
 *   JSON.parse가 그냥은 실패한다** — 사이트 자체 JS도 파싱 전에
 *   `data.replace(/\r/gi,'\\r').replace(/\n/gi,'\\n')` 를 거친다. 우리도 똑같이 한다.
 *
 *   `PerfCasting` 필드가 `<p><img src="https://tkfile.yes24.com/..."></p>` 형태의 HTML 조각이다.
 *   비어 있거나 `<p><br></p>`면 캐스팅표가 없는 공연 — 조용히 넘기지 않고 에러를 던진다.
 *
 * ③ 판독 — transform.ts(2-2)가 이 이미지를 claude -p로 읽어 회차별 캐스팅 JSON을 만든다.
 *   실측: 960×3514 이미지 1장 → 회차 52건 전부 형식 검증 통과 (README 참고).
 */
import type { ExtractedBundle } from "../../shared/etl.ts";
import { writeTmp } from "../../shared/tmp.ts";
import { politeSleep } from "../../shared/sleep.ts";
import * as log from "../../shared/log.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export interface Yes24Show {
  idPerf: string;
  url: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  venue: string;
  address: string;
  price: number | null;
  organizer: string;
  cast: string[]; // 작품 전체 출연진 (회차별 아님)
  poster: string;
}

interface LdEvent {
  "@type"?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  image?: string | string[];
  location?: { name?: string; address?: { streetAddress?: string } };
  offers?: { price?: number | string };
  organizer?: { name?: string };
  performer?: { name?: string | string[] } | { name?: string | string[] }[];
}

export function detailUrl(idPerf: string): string {
  return `https://ticket.yes24.com/Perf/${idPerf}`;
}

export function parseShow(html: string, idPerf: string): Yes24Show {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (blocks.length === 0) {
    throw new Error(`예스24 ${idPerf}: JSON-LD가 없습니다. 페이지 구조가 바뀌었거나 차단됐을 수 있습니다.`);
  }

  let ev: LdEvent | null = null;
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b[1]!) as LdEvent;
      if (parsed["@type"] === "Event") {
        ev = parsed;
        break;
      }
    } catch {
      // 다른 종류의 JSON-LD 블록은 건너뛴다.
    }
  }
  if (!ev) throw new Error(`예스24 ${idPerf}: JSON-LD에 Event 노드가 없습니다.`);

  const performers = Array.isArray(ev.performer) ? ev.performer : ev.performer ? [ev.performer] : [];
  const cast = performers.flatMap((p) => (Array.isArray(p.name) ? p.name : p.name ? [p.name] : []));
  const image = Array.isArray(ev.image) ? ev.image[0] : ev.image;

  return {
    idPerf,
    url: detailUrl(idPerf),
    name: decodeEntities(ev.name ?? ""),
    startDate: (ev.startDate ?? "").slice(0, 10),
    endDate: (ev.endDate ?? "").slice(0, 10),
    venue: ev.location?.name ?? "",
    address: ev.location?.address?.streetAddress ?? "",
    price: ev.offers?.price !== undefined ? Number(ev.offers.price) || null : null,
    organizer: ev.organizer?.name ?? "",
    cast: cast.map((s) => s.trim()).filter(Boolean),
    poster: normalizeUrl(image ?? ""),
  };
}

export async function fetchShow(idPerf: string): Promise<Yes24Show> {
  const res = await fetch(detailUrl(idPerf), {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
  });
  if (!res.ok) throw new Error(`예스24 ${idPerf} 상세페이지 HTTP ${res.status}`);
  const show = parseShow(await res.text(), idPerf);
  log.info("ticket-casting", `예스24 ${idPerf} — ${show.name}`, {
    기간: `${show.startDate}~${show.endDate}`,
    출연: show.cast.length,
  });
  await politeSleep();
  return show;
}

interface PerfContents {
  Result?: string;
  Msg?: string;
  PerfCasting?: string;
}

/** 리터럴 CR/LF가 섞인 응답 본문을 사이트 자체 JS와 같은 방식으로 정리해 파싱한다. */
export function parsePerfContents(raw: string): PerfContents {
  const cleaned = raw.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  try {
    return JSON.parse(cleaned) as PerfContents;
  } catch (err) {
    throw new Error(
      `예스24 axPerfContents 응답 파싱 실패: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/** PerfCasting HTML 조각에서 이미지 URL을 뽑는다. */
export function extractCastingImageUrls(perfCasting: string): string[] {
  const trimmed = perfCasting.trim();
  if (!trimmed || trimmed === "<p><br></p>") return [];
  return [...trimmed.matchAll(/<img[^>]*\ssrc="([^"]+)"/gi)]
    .map((m) => normalizeUrl(m[1]!))
    .filter(Boolean);
}

export async function fetchCastingImageUrls(idPerf: string): Promise<string[]> {
  const res = await fetch(
    `https://ticket.yes24.com/New/Perf/Detail/Ajax/axPerfContents.aspx?IdPerf=${encodeURIComponent(idPerf)}`,
    {
      headers: {
        "User-Agent": UA,
        Referer: detailUrl(idPerf),
        "X-Requested-With": "XMLHttpRequest",
      },
    },
  );
  if (!res.ok) throw new Error(`예스24 ${idPerf} axPerfContents HTTP ${res.status}`);

  const contents = parsePerfContents(await res.text());
  const urls = extractCastingImageUrls(contents.PerfCasting ?? "");
  if (urls.length === 0) {
    // 캐스팅표가 없는 공연(원캐스트 등)일 수도 있지만, 회차별 캐스팅이 이 프로젝트의 핵심
    // 데이터라 조용히 넘기지 않고 에러로 알린다. 정말 없는 공연이면 호출부에서 잡아 스킵한다.
    throw new Error(`예스24 ${idPerf}: 캐스팅표 이미지가 없습니다 (PerfCasting 비어 있음).`);
  }
  log.info("ticket-casting", `예스24 ${idPerf} 캐스팅표 이미지 ${urls.length}장`);
  await politeSleep();
  return urls;
}

export async function downloadCastingImages(idPerf: string): Promise<string[]> {
  const urls = await fetchCastingImageUrls(idPerf);
  const paths: string[] = [];
  for (const [i, url] of urls.entries()) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      log.warn("ticket-casting", `예스24 ${idPerf} 캐스팅표 이미지 다운로드 실패 ${res.status}`, url);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    paths.push(writeTmp(`yes24-${idPerf}-${i}${extOf(url)}`, buf));
  }
  return paths;
}

export function toBundle(show: Yes24Show, imagePaths: string[] = []): ExtractedBundle {
  return {
    source: "yes24",
    sourceId: show.idPerf,
    url: show.url,
    fetchedAt: new Date().toISOString(),
    postedAt: null,
    text: [
      `공연명: ${show.name}`,
      `기간: ${show.startDate} ~ ${show.endDate}`,
      `장소: ${show.venue} (${show.address})`,
      `가격: ${show.price ?? "-"}`,
      `제작: ${show.organizer}`,
      `출연(작품 전체): ${show.cast.join(", ")}`,
    ].join("\n"),
    imagePaths,
    imageUrls: show.poster ? [show.poster] : [],
    meta: {
      site: "yes24",
      idPerf: show.idPerf,
      showName: show.name,
      startDate: show.startDate,
      endDate: show.endDate,
      organizer: show.organizer,
    },
  };
}

function normalizeUrl(u: string): string {
  if (!u) return "";
  return u.startsWith("//") ? `https:${u}` : u;
}

function extOf(url: string): string {
  const m = /\.(png|jpe?g|webp|gif)(?:$|\?)/i.exec(url);
  return m?.[1] ? `.${m[1].toLowerCase()}` : ".jpg";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
