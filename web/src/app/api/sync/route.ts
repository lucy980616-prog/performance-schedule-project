import { NextResponse } from "next/server";
import { listShows, type GenreCode } from "@/lib/kopis";
import { upsertShowSummary } from "@/lib/queries";

export const runtime = "nodejs";

const compact = (d: string) => d.replaceAll("-", "");

/**
 * KOPIS 공연목록을 로컬 DB로 가져온다.
 * KOPIS는 한 요청당 최대 31일 구간만 허용하므로 월 단위로 끊어서 호출한다.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      months?: number;
      genres?: GenreCode[];
    };

    const months = Math.min(Math.max(body.months ?? 3, 1), 12);
    const genres: (GenreCode | undefined)[] = body.genres?.length
      ? body.genres
      : ["AAAA", "GGGA"]; // 기본은 연극 + 뮤지컬

    let imported = 0;
    const cursor = new Date();

    for (let m = 0; m < months; m++) {
      const from = new Date(cursor.getFullYear(), cursor.getMonth() + m, 1);
      const to = new Date(cursor.getFullYear(), cursor.getMonth() + m + 1, 0);

      for (const genre of genres) {
        // rows 최대 100. 한 장르/한 달에 100건이 넘으면 페이지를 넘긴다.
        for (let page = 1; page <= 10; page++) {
          const list = await listShows({
            startDate: compact(from.toISOString().slice(0, 10)),
            endDate: compact(to.toISOString().slice(0, 10)),
            page,
            rows: 100,
            genre,
          });

          for (const s of list) upsertShowSummary(s);
          imported += list.length;

          if (list.length < 100) break;
        }
      }
    }

    return NextResponse.json({ ok: true, imported });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
