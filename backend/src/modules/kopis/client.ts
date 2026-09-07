import { XMLParser } from "fast-xml-parser";

/**
 * KOPIS(공연예술통합전산망) 오픈API 클라이언트.
 *
 * 인증키는 https://www.kopis.or.kr/por/cs/openapi/openApiUseSend.do 에서 발급.
 * 이용 시 출처 명시가 필수다: "출처: (재)예술경영지원센터 공연예술통합전산망(www.kopis.or.kr)"
 *
 * 개발가이드 원문: docs/kopis-openapi-guide.pdf
 *
 * ⚠️ 이 클라이언트의 필드명은 개발가이드 PDF 기준으로만 작성됐다. 인증키를 받으면
 *    `npm test -- --test-name-pattern=live` 로 실제 응답과 대조하는 것이 첫 할 일이다.
 */

const BASE = "http://www.kopis.or.kr/openApi/restful";

/** shcate — 장르 코드 (docs/kopis-codes.pdf) */
export const GENRES = {
  AAAA: "연극",
  GGGA: "뮤지컬",
  CCCA: "서양음악(클래식)",
  CCCC: "한국음악(국악)",
  CCCD: "대중음악",
  BBBC: "무용(서양/한국무용)",
  BBBE: "대중무용",
  EEEA: "서커스/마술",
  EEEB: "복합",
} as const;

export type GenreCode = keyof typeof GENRES;

/** prfstate — 공연상태 코드 */
export const STATES = {
  "01": "공연예정",
  "02": "공연중",
  "03": "공연완료",
} as const;

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // 공연ID(PF...)나 날짜가 숫자로 뭉개지는 걸 방지
  trimValues: true,
});

function apiKey(): string {
  const key = process.env.KOPIS_API_KEY;
  if (!key) {
    throw new Error(
      "KOPIS_API_KEY가 설정되지 않았습니다. backend/.env 에 KOPIS_API_KEY=발급받은키 를 추가하세요.",
    );
  }
  return key;
}

async function call(pathname: string, params: Record<string, string | undefined>) {
  const url = new URL(`${BASE}${pathname}`);
  url.searchParams.set("service", apiKey());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`KOPIS API ${res.status} ${res.statusText} (${pathname})`);
  }

  const xml = await res.text();
  // 인증키가 틀리면 200에 에러 XML이 온다.
  if (xml.includes("<returnReasonCode>") || xml.includes("SERVICE_KEY")) {
    const reason = /<returnAuthMsg>(.*?)<\/returnAuthMsg>/.exec(xml)?.[1];
    throw new Error(`KOPIS API 인증 오류: ${reason ?? xml.slice(0, 200)}`);
  }
  return parser.parse(xml);
}

/** 배열이 아닐 수 있는 XML 노드를 배열로 정규화 */
function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

/** KOPIS는 2016.05.12 형식, 우리는 2016-05-12로 통일 */
function normalizeDate(v: unknown): string {
  const s = str(v).trim();
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(s);
  if (!m) return s;
  const [, y = "", mo = "", d = ""] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export interface KopisShowSummary {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  facility: string;
  poster: string;
  area: string;
  genre: string;
  state: string;
  openrun: string;
}

export interface KopisShowDetail extends KopisShowSummary {
  facilityId: string;
  runtime: string;
  age: string;
  price: string;
  castRaw: string;
  crewRaw: string;
  company: string;
  story: string;
  timeGuidance: string;
}

/** 공연목록 조회 (pblprfr) */
export async function listShows(opts: {
  startDate: string; // YYYYMMDD
  endDate: string; // YYYYMMDD — 시작일로부터 최대 31일
  page?: number;
  rows?: number; // 최대 100
  genre?: GenreCode;
  state?: keyof typeof STATES;
  keyword?: string;
  areaCode?: string; // signgucode (시도)
}): Promise<KopisShowSummary[]> {
  const json = await call("/pblprfr", {
    stdate: opts.startDate,
    eddate: opts.endDate,
    cpage: String(opts.page ?? 1),
    rows: String(opts.rows ?? 100),
    shcate: opts.genre,
    prfstate: opts.state,
    shprfnm: opts.keyword,
    signgucode: opts.areaCode,
  });

  return arr<Record<string, unknown>>(json?.dbs?.db).map((d) => ({
    id: str(d.mt20id),
    name: str(d.prfnm),
    startDate: normalizeDate(d.prfpdfrom),
    endDate: normalizeDate(d.prfpdto),
    facility: str(d.fcltynm),
    poster: str(d.poster),
    area: str(d.area),
    genre: str(d.genrenm),
    state: str(d.prfstate),
    openrun: str(d.openrun),
  }));
}

/** 공연상세 조회 (pblprfr/{id}) — prfcast/prfcrew 포함 */
export async function getShow(id: string): Promise<KopisShowDetail | null> {
  const json = await call(`/pblprfr/${encodeURIComponent(id)}`, {});
  const d = arr<Record<string, unknown>>(json?.dbs?.db)[0];
  if (!d) return null;

  return {
    id: str(d.mt20id),
    name: str(d.prfnm),
    startDate: normalizeDate(d.prfpdfrom),
    endDate: normalizeDate(d.prfpdto),
    facility: str(d.fcltynm),
    facilityId: str(d.mt10id),
    poster: str(d.poster),
    area: str(d.area),
    genre: str(d.genrenm),
    state: str(d.prfstate),
    openrun: str(d.openrun),
    runtime: str(d.prfruntime),
    age: str(d.prfage),
    price: str(d.pcseguidance),
    castRaw: str(d.prfcast),
    crewRaw: str(d.prfcrew),
    company: str(d.entrpsnm),
    story: str(d.sty),
    timeGuidance: str(d.dtguidance),
  };
}

/** "차인표, 오만석, 연정훈" → ["차인표","오만석","연정훈"] */
export function splitNames(raw: string): string[] {
  return raw
    .split(/[,、·/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 30);
}
