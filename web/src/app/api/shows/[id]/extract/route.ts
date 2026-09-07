import { NextResponse } from "next/server";
import { extractCasting, isSupportedImage } from "@/lib/extract";
import { splitNames } from "@/lib/kopis";
import { getShowRow, setCasting, setRoles, upsertShowtime } from "@/lib/queries";

export const runtime = "nodejs";
export const maxDuration = 300; // 이미지 추출은 시간이 걸릴 수 있다

type Ctx = { params: Promise<{ id: string }> };

/**
 * 예매처에서 복사한 텍스트 또는 캡처 이미지를 회차별 캐스팅으로 변환해 저장한다.
 *
 * multipart/form-data:
 *   - image: 캡처 파일  (또는)
 *   - text:  붙여넣은 텍스트
 *   - dryRun: "1" 이면 저장하지 않고 결과만 돌려준다
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  try {
    const show = getShowRow(id);
    if (!show) {
      return NextResponse.json(
        { ok: false, error: "먼저 공연 정보를 불러와 주세요." },
        { status: 404 },
      );
    }

    const form = await req.formData();
    const dryRun = form.get("dryRun") === "1";
    const text = form.get("text");
    const image = form.get("image");

    const ctx = {
      showName: show.name,
      startDate: show.start_date ?? "",
      endDate: show.end_date ?? "",
      knownActors: show.cast_raw ? splitNames(show.cast_raw) : undefined,
    };

    let result;
    if (image instanceof File && image.size > 0) {
      if (!isSupportedImage(image.type)) {
        return NextResponse.json(
          { ok: false, error: `지원하지 않는 이미지 형식입니다: ${image.type}` },
          { status: 400 },
        );
      }
      const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
      result = await extractCasting({ imageBase64: base64, mediaType: image.type }, ctx);
    } else if (typeof text === "string" && text.trim()) {
      result = await extractCasting({ text: text.trim() }, ctx);
    } else {
      return NextResponse.json(
        { ok: false, error: "텍스트나 이미지 중 하나는 있어야 합니다." },
        { status: 400 },
      );
    }

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, result });
    }

    // 배역 정보로 배우 → 배역 역인덱스를 만들어 회차 캐스팅에 붙인다.
    const roleByActor: Record<string, string> = {};
    for (const r of result.roles) {
      for (const a of r.actors) roleByActor[a.trim()] = r.role;
    }

    let saved = 0;
    for (const e of result.entries) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !/^\d{2}:\d{2}$/.test(e.time)) continue;
      const showtimeId = upsertShowtime(id, e.date, e.time, e.note);
      setCasting(showtimeId, e.actors, roleByActor);
      saved++;
    }
    setRoles(id, result.roles);

    return NextResponse.json({
      ok: true,
      saved,
      roles: result.roles.length,
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
