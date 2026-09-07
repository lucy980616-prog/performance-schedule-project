import { listShows, getShow, type GenreCode, type KopisShowDetail, type KopisShowSummary } from "./client.ts";
import { sleep } from "../../shared/sleep.ts";
import * as log from "../../shared/log.ts";

/**
 * 공연목록을 기간·장르별로 훑는다.
 *
 * KOPIS는 한 요청당 최대 31일 구간만 허용하므로 월 단위로 끊어서 호출한다.
 * 저장은 하지 않는다 — 어디에 넣을지는 호출부(현재 SQLite, 나중에 Supabase)가 정한다.
 */

const compact = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

export interface SyncResult {
  shows: KopisShowSummary[];
  requests: number;
}

export async function syncShows(opts: {
  months?: number;
  genres?: GenreCode[];
  /** 공식 API지만 예의상 간격을 둔다. 0이면 쉬지 않는다. */
  delayMs?: number;
} = {}): Promise<SyncResult> {
  const months = Math.min(Math.max(opts.months ?? 3, 1), 12);
  const genres = opts.genres?.length ? opts.genres : (["AAAA", "GGGA"] as GenreCode[]); // 연극 + 뮤지컬
  const delayMs = opts.delayMs ?? 300;

  const byId = new Map<string, KopisShowSummary>();
  const now = new Date();
  let requests = 0;

  for (let m = 0; m < months; m++) {
    const from = new Date(now.getFullYear(), now.getMonth() + m, 1);
    const to = new Date(now.getFullYear(), now.getMonth() + m + 1, 0);

    for (const genre of genres) {
      // rows 최대 100. 한 장르/한 달에 100건이 넘으면 페이지를 넘긴다.
      for (let page = 1; page <= 10; page++) {
        const list = await listShows({
          startDate: compact(from),
          endDate: compact(to),
          page,
          rows: 100,
          genre,
        });
        requests++;
        for (const s of list) byId.set(s.id, s);
        if (delayMs > 0) await sleep(delayMs);
        if (list.length < 100) break;
      }
    }
  }

  log.info("kopis", `공연 ${byId.size}건 (요청 ${requests}회)`);
  return { shows: [...byId.values()], requests };
}

/** 추적 중인 공연의 상세(출연진·요일별 공연시간)를 가져온다. */
export async function syncDetails(
  ids: string[],
  delayMs = 300,
): Promise<KopisShowDetail[]> {
  const out: KopisShowDetail[] = [];
  for (const id of ids) {
    const d = await getShow(id);
    if (d) out.push(d);
    else log.warn("kopis", `상세 없음: ${id}`);
    if (delayMs > 0) await sleep(delayMs);
  }
  return out;
}
