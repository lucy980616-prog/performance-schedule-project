import { NextResponse } from "next/server";
import { getShow } from "@/lib/kopis";
import { getShowRow, seedShowtimes, setTracked, upsertShowDetail } from "@/lib/queries";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** 공연 상세를 KOPIS에서 받아오고, 요일 패턴으로 회차 뼈대를 만든다. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      track?: boolean;
      seed?: boolean;
    };

    if (typeof body.track === "boolean") {
      setTracked(id, body.track);
      // 추적 해제만 요청한 경우 KOPIS를 다시 부를 필요는 없다.
      if (body.track === false) return NextResponse.json({ ok: true, tracked: false });
    }

    const detail = await getShow(id);
    if (!detail) {
      return NextResponse.json({ ok: false, error: "KOPIS에 없는 공연 ID입니다." }, { status: 404 });
    }
    upsertShowDetail(detail);

    let seeded = 0;
    if (body.seed !== false && detail.timeGuidance) {
      seeded = seedShowtimes(id, detail.timeGuidance, detail.startDate, detail.endDate);
    }

    return NextResponse.json({ ok: true, show: getShowRow(id), seeded });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
