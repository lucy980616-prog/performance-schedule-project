/**
 * Load 단계 — 2-1/2-2에서 나온 결과를 backend/data/collector.db 에 쓴다.
 *
 * 이 모듈만 SQL을 안다. 다른 곳(nol.ts/yes24.ts/transform.ts/cli.ts)은 DB 스키마를 모른 채
 * upsertShow/saveCasting 만 호출한다 — 저장소를 SQLite에서 Supabase로 옮길 때 여기만 바뀐다.
 */
import { db } from "../../shared/db.ts";
import * as log from "../../shared/log.ts";
import type { CastingExtraction } from "./schema.ts";

export interface UpsertShowInput {
  source: string; // 'nol' | 'yes24' | 'ticketlink'
  sourceId: string;
  name: string;
  genre?: string | null; // 'musical' | 'play'
  startDate?: string | null;
  endDate?: string | null;
  venue?: string | null;
  address?: string | null;
  price?: number | null;
  organizer?: string | null;
  castRaw?: string | null;
  poster?: string | null;
  url?: string | null;
}

export interface ShowRow {
  id: number;
  source: string;
  source_id: string;
  name: string;
  genre: string | null;
  start_date: string | null;
  end_date: string | null;
  venue: string | null;
  address: string | null;
  price: number | null;
  organizer: string | null;
  cast_raw: string | null;
  poster: string | null;
  url: string | null;
  discovered_at: string;
  synced_at: string | null;
}

export function upsertShow(input: UpsertShowInput): number {
  const now = new Date().toISOString();

  db().prepare(`
    INSERT INTO shows
      (source, source_id, name, genre, start_date, end_date, venue, address, price, organizer, cast_raw, poster, url, discovered_at, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source, source_id) DO UPDATE SET
      name       = excluded.name,
      genre      = excluded.genre,
      start_date = excluded.start_date,
      end_date   = excluded.end_date,
      venue      = excluded.venue,
      address    = excluded.address,
      price      = excluded.price,
      organizer  = excluded.organizer,
      cast_raw   = excluded.cast_raw,
      poster     = excluded.poster,
      url        = excluded.url,
      synced_at  = excluded.synced_at
  `).run(
    input.source,
    input.sourceId,
    input.name,
    input.genre ?? null,
    input.startDate ?? null,
    input.endDate ?? null,
    input.venue ?? null,
    input.address ?? null,
    input.price ?? null,
    input.organizer ?? null,
    input.castRaw ?? null,
    input.poster ?? null,
    input.url ?? null,
    now,
    now,
  );

  const row = db()
    .prepare(`SELECT id FROM shows WHERE source = ? AND source_id = ?`)
    .get(input.source, input.sourceId) as { id: number } | undefined;
  if (!row) throw new Error(`upsertShow 이후 show를 다시 찾지 못했습니다 (${input.source}:${input.sourceId})`);
  return row.id;
}

export function getShow(source: string, sourceId: string): ShowRow | undefined {
  return db()
    .prepare(`SELECT * FROM shows WHERE source = ? AND source_id = ?`)
    .get(source, sourceId) as ShowRow | undefined;
}

export function getShowById(id: number): ShowRow | undefined {
  return db().prepare(`SELECT * FROM shows WHERE id = ?`).get(id) as ShowRow | undefined;
}

export function listShows(): ShowRow[] {
  return db().prepare(`SELECT * FROM shows ORDER BY start_date`).all() as unknown as ShowRow[];
}

/**
 * CastingExtraction(회차별 캐스팅 + 배역별 배우 풀)을 통째로 저장한다.
 * showtimes/castings/roles 세 테이블에 나눠 쓴다.
 *
 * source는 이 데이터가 어디서 왔는지 남긴다 — 'nol-api'(오독 위험 없음) 인지
 * 'claude-p'(AI 판독, warnings 있을 수 있음) 인지 나중에 신뢰도 판단에 쓴다.
 */
export function saveCasting(
  showId: number,
  extraction: CastingExtraction,
  source: "nol-api" | "claude-p" | "manual",
): { showtimes: number; castings: number; roles: number } {
  const database = db();
  let showtimeCount = 0;
  let castingCount = 0;

  const upsertShowtime = database.prepare(`
    INSERT INTO showtimes (show_id, date, time, note)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(show_id, date, time) DO UPDATE SET note = excluded.note
  `);
  const findShowtimeId = database.prepare(
    `SELECT id FROM showtimes WHERE show_id = ? AND date = ? AND time = ?`,
  );
  const upsertCasting = database.prepare(`
    INSERT INTO castings (showtime_id, actor, role, source)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(showtime_id, actor) DO UPDATE SET role = excluded.role, source = excluded.source
  `);
  const upsertRole = database.prepare(`
    INSERT INTO roles (show_id, role, actor, ord)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(show_id, role, actor) DO NOTHING
  `);

  const roleByActor = new Map<string, string>();
  extraction.roles.forEach((r, i) => {
    r.actors.forEach((actor) => {
      roleByActor.set(actor, r.role);
      upsertRole.run(showId, r.role, actor, i);
    });
  });

  for (const entry of extraction.entries) {
    upsertShowtime.run(showId, entry.date, entry.time, entry.note ?? null);
    const showtimeRow = findShowtimeId.get(showId, entry.date, entry.time) as
      | { id: number }
      | undefined;
    if (!showtimeRow) continue; // 이론상 없을 수 없지만, 있어도 여기서 죽지 않는다.
    showtimeCount++;

    for (const actor of entry.actors) {
      upsertCasting.run(showtimeRow.id, actor, roleByActor.get(actor) ?? null, source);
      castingCount++;
    }
  }

  log.info(
    "ticket-casting",
    `show#${showId} 저장 완료 (${source})`,
    { showtimes: showtimeCount, castings: castingCount, roles: extraction.roles.length },
  );

  return { showtimes: showtimeCount, castings: castingCount, roles: extraction.roles.length };
}
