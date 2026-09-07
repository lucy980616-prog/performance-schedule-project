/**
 * 모듈 2-1 (Extract) — 티켓링크.
 *
 * 2026-09-07 실측 결론: **브라우저를 쓰지 말고 정적 HTML의 JSON-LD를 읽는다.**
 *
 * 티켓링크 상세페이지는 SPA지만, 서버가 내려주는 HTML에 schema.org JSON-LD가 들어 있다.
 * 여기에 공연명·기간·장소·주소·가격·주최사·**출연진 전체**가 다 들어 있고,
 * 단순 GET 한 번이면 된다.
 *
 *   https://www.ticketlink.co.kr/product/65490
 *     name      뮤지컬 <죽음에 관하여> '삶과 죽음의 경계선 DAY' 2nd
 *     기간      2026-09-24 ~ 2026-10-04
 *     장소      링크아트센터드림 드림3관
 *     가격      66000
 *     주최      주식회사 낭만바리케이트
 *     performer 성태준 조성윤 유승현 | 강찬 박좌헌 신주협
 *
 * ⚠️ **Playwright로는 접근할 수 없다.** 티켓링크는 rfQNS 계열 안티봇 WAF를 쓰고,
 *    headless / headful 어느 쪽으로 띄워도 상세페이지가 /500 으로 리다이렉트된다.
 *    브라우저 안에서 나가는 내부 API(mapi.ticketlink.co.kr/mapi/product/{id}/detail) 호출도
 *    같이 막히고(에러 JSON 122바이트), 그 API는 WAF가 만든 동적 토큰이 있어야 해서
 *    직접 호출도 불가능하다. 1차 조사에서 "비정상 활동 감지" 경고가 났던 것과 같은 맥락이다.
 *
 * ⚠️ 그래서 **회차별 캐스팅 이미지(상세 설명 영역)는 자동으로 못 가져온다.**
 *    JSON-LD의 performer는 "이 작품 전체 출연진"이지 "몇 일 몇 시에 누가"가 아니다.
 *    회차별 캐스팅은 아래 중 하나로 채운다:
 *      (a) 캐스팅표 이미지를 사람이 fixtures/ticket-casting/ 에 넣고 2-2로 판독  ← 지금 방식
 *      (b) 모듈 ③ — 제작사 X 계정이 회차별 캐스팅을 그림/글로 올린다 (실측 확인)
 *      (c) 다른 예매처(인터파크/예스24)에 같은 공연이 있으면 그쪽에서 (미조사)
 *
 * ⚠️ HTTP/2로 연결하면 프로토콜 에러가 난다. 티켓링크는 HTTP/1.1이므로 fetch를 쓴다.
 *    (X 신디케이션은 반대로 fetch가 막혀서 http2를 쓴다 — shared/http.ts 참고)
 */
import type { ExtractedBundle } from "../../shared/etl.ts";
import * as log from "../../shared/log.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export interface TicketlinkShow {
  productId: string;
  url: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  venue: string;
  address: string;
  price: number | null;
  organizer: string;
  /** JSON-LD performer — 작품 전체 출연진. 회차별 캐스팅이 아니다. */
  castRaw: string;
  poster: string;
}

/** JSON-LD Event 노드의 우리가 쓰는 필드만. */
interface LdEvent {
  "@type"?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  image?: string | string[];
  location?: { name?: string; address?: { streetAddress?: string } };
  offers?: { price?: number | string };
  organizer?: { name?: string };
  performer?: { name?: string } | { name?: string }[];
}

export function productUrl(productId: string): string {
  return `https://www.ticketlink.co.kr/product/${productId}`;
}

/** 상세페이지 HTML에서 JSON-LD Event를 뽑아 공연 정보로 만든다. */
export function parseProduct(html: string, productId: string): TicketlinkShow {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (blocks.length === 0) {
    // 조용히 빈 값을 돌려주지 않는다. WAF에 막혔거나 페이지 구조가 바뀐 것이다.
    throw new Error(
      `티켓링크 ${productId}: JSON-LD가 없습니다. 차단됐거나 페이지 구조가 바뀌었습니다.`,
    );
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
      // Product 노드 등 다른 블록은 건너뛴다.
    }
  }
  if (!ev) throw new Error(`티켓링크 ${productId}: JSON-LD에 Event 노드가 없습니다.`);

  const performers = Array.isArray(ev.performer) ? ev.performer : ev.performer ? [ev.performer] : [];
  const image = Array.isArray(ev.image) ? ev.image[0] : ev.image;

  return {
    productId,
    url: productUrl(productId),
    name: decodeEntities(ev.name ?? ""),
    startDate: (ev.startDate ?? "").slice(0, 10),
    endDate: (ev.endDate ?? "").slice(0, 10),
    venue: ev.location?.name ?? "",
    address: ev.location?.address?.streetAddress ?? "",
    price: ev.offers?.price !== undefined ? Number(ev.offers.price) || null : null,
    organizer: ev.organizer?.name ?? "",
    castRaw: performers.map((p) => p.name ?? "").filter(Boolean).join(" "),
    poster: image ?? "",
  };
}

/** "성태준 조성윤 유승현 | 강찬 박좌헌 신주협" → 배우 이름 배열 */
export function splitPerformers(castRaw: string): string[] {
  return castRaw
    .split(/[|,·/\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 20);
}

export async function fetchProduct(productId: string): Promise<TicketlinkShow> {
  const res = await fetch(productUrl(productId), {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
  });
  if (!res.ok) throw new Error(`티켓링크 ${productId}: HTTP ${res.status}`);

  const show = parseProduct(await res.text(), productId);
  log.info("ticket-casting", `티켓링크 ${productId} — ${show.name}`, {
    기간: `${show.startDate}~${show.endDate}`,
    출연: splitPerformers(show.castRaw).length,
  });
  return show;
}

/**
 * 2-2로 넘길 번들을 만든다.
 *
 * imagePaths는 비어 있다 — 회차별 캐스팅 이미지를 WAF 때문에 못 가져오기 때문이다.
 * 사람이 캡처를 fixtures에 넣어 두면 호출부가 imagePaths에 채워서 넘긴다.
 */
export function toBundle(show: TicketlinkShow, imagePaths: string[] = []): ExtractedBundle {
  return {
    source: "ticketlink",
    sourceId: show.productId,
    url: show.url,
    fetchedAt: new Date().toISOString(),
    postedAt: null,
    text: [
      `공연명: ${show.name}`,
      `기간: ${show.startDate} ~ ${show.endDate}`,
      `장소: ${show.venue} (${show.address})`,
      `가격: ${show.price ?? "-"}`,
      `제작: ${show.organizer}`,
      `출연(작품 전체): ${show.castRaw}`,
    ].join("\n"),
    imagePaths,
    imageUrls: show.poster ? [show.poster] : [],
    meta: {
      site: "ticketlink",
      productId: show.productId,
      showName: show.name,
      startDate: show.startDate,
      endDate: show.endDate,
      organizer: show.organizer,
    },
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
