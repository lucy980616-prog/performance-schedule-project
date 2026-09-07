import { NextResponse } from "next/server";
import { addFavoriteActor, listFavoriteActors, removeFavoriteActor } from "@/lib/queries";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, actors: listFavoriteActors() });
}

export async function POST(req: Request) {
  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) {
    return NextResponse.json({ ok: false, error: "배우 이름이 필요합니다." }, { status: 400 });
  }
  addFavoriteActor(name);
  return NextResponse.json({ ok: true, actors: listFavoriteActors() });
}

export async function DELETE(req: Request) {
  const { name } = (await req.json()) as { name?: string };
  if (!name) {
    return NextResponse.json({ ok: false, error: "배우 이름이 필요합니다." }, { status: 400 });
  }
  removeFavoriteActor(name);
  return NextResponse.json({ ok: true, actors: listFavoriteActors() });
}
