import { db } from "./db";
import type { KopisShowDetail, KopisShowSummary } from "./kopis";
import { generateShowtimes } from "./schedule";

export interface ShowRow {
  id: string;
  name: string;
  genre: string | null;
  poster: string | null;
  area: string | null;
  start_date: string | null;
  end_date: string | null;
  facility: string | null;
  state: string | null;
  runtime: string | null;
  age: string | null;
  price: string | null;
  cast_raw: string | null;
  crew_raw: string | null;
  company: string | null;
  story: string | null;
  time_guidance: string | null;
  detail_synced: number;
  tracked: number;
}

const rows = <T>(sql: string, ...params: unknown[]): T[] =>
  db().prepare(sql).all(...(params as never[])) as T[];

const one = <T>(sql: string, ...params: unknown[]): T | undefined =>
  db().prepare(sql).get(...(params as never[])) as T | undefined;

const run = (sql: string, ...params: unknown[]) =>
  db().prepare(sql).run(...(params as never[]));

/* ---------------------------------- 공연 ---------------------------------- */

export function upsertShowSummary(s: KopisShowSummary) {
  run(
    `INSERT INTO shows (id, name, genre, poster, area, start_date, end_date, facility, state, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, genre=excluded.genre, poster=excluded.poster,
       area=excluded.area, start_date=excluded.start_date, end_date=excluded.end_date,
       facility=excluded.facility, state=excluded.state, synced_at=datetime('now')`,
    s.id, s.name, s.genre, s.poster, s.area, s.startDate, s.endDate, s.facility, s.state,
  );
}

export function upsertShowDetail(d: KopisShowDetail) {
  upsertShowSummary(d);
  run(
    `UPDATE shows SET
       facility_id=?, runtime=?, age=?, price=?, cast_raw=?, crew_raw=?,
       company=?, story=?, time_guidance=?, detail_synced=1
     WHERE id=?`,
    d.facilityId, d.runtime, d.age, d.price, d.castRaw, d.crewRaw,
    d.company, d.story, d.timeGuidance, d.id,
  );
}

export function getShowRow(id: string) {
  return one<ShowRow>("SELECT * FROM shows WHERE id=?", id);
}

export function listShowRows(opts: { tracked?: boolean; state?: string; genre?: string } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.tracked) where.push("tracked=1");
  if (opts.state) { where.push("state=?"); params.push(opts.state); }
  if (opts.genre) { where.push("genre=?"); params.push(opts.genre); }

  return rows<ShowRow>(
    `SELECT * FROM shows ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY (state='공연중') DESC, start_date ASC`,
    ...params,
  );
}

export function setTracked(id: string, tracked: boolean) {
  run("UPDATE shows SET tracked=? WHERE id=?", tracked ? 1 : 0, id);
}

/* --------------------------------- 회차 ---------------------------------- */

/** KOPIS 요일 패턴으로 회차 뼈대를 만든다. 기존 회차는 건드리지 않는다. */
export function seedShowtimes(showId: string, guidance: string, start: string, end: string) {
  const generated = generateShowtimes(guidance, start, end);
  const stmt = db().prepare(
    "INSERT OR IGNORE INTO showtimes (show_id, date, time) VALUES (?,?,?)",
  );
  for (const g of generated) stmt.run(showId, g.date, g.time);
  return generated.length;
}

export interface ShowtimeRow {
  id: number;
  show_id: string;
  date: string;
  time: string;
  note: string | null;
}

export function listShowtimes(showId: string) {
  return rows<ShowtimeRow>(
    "SELECT * FROM showtimes WHERE show_id=? ORDER BY date, time",
    showId,
  );
}

export function upsertShowtime(showId: string, date: string, time: string, note?: string | null) {
  run(
    `INSERT INTO showtimes (show_id, date, time, note) VALUES (?,?,?,?)
     ON CONFLICT(show_id, date, time) DO UPDATE SET note=COALESCE(excluded.note, showtimes.note)`,
    showId, date, time, note ?? null,
  );
  return one<{ id: number }>(
    "SELECT id FROM showtimes WHERE show_id=? AND date=? AND time=?",
    showId, date, time,
  )!.id;
}

export function deleteShowtime(id: number) {
  run("DELETE FROM showtimes WHERE id=?", id);
}

/* -------------------------------- 캐스팅 --------------------------------- */

export function setCasting(showtimeId: number, actors: string[], roleByActor?: Record<string, string>) {
  run("DELETE FROM castings WHERE showtime_id=?", showtimeId);
  const stmt = db().prepare(
    "INSERT OR IGNORE INTO castings (showtime_id, actor, role) VALUES (?,?,?)",
  );
  for (const a of actors) {
    const name = a.trim();
    if (name) stmt.run(showtimeId, name, roleByActor?.[name] ?? null);
  }
}

export function setRoles(showId: string, roleList: { role: string; actors: string[] }[]) {
  if (roleList.length === 0) return;
  run("DELETE FROM roles WHERE show_id=?", showId);
  const stmt = db().prepare(
    "INSERT OR IGNORE INTO roles (show_id, role, actor, ord) VALUES (?,?,?,?)",
  );
  roleList.forEach((r, i) => {
    r.actors.forEach((a) => {
      const name = a.trim();
      if (name) stmt.run(showId, r.role, name, i);
    });
  });
}

export function listRoles(showId: string) {
  return rows<{ role: string; actor: string; ord: number }>(
    "SELECT role, actor, ord FROM roles WHERE show_id=? ORDER BY ord, role, actor",
    showId,
  );
}

/** 한 공연의 회차 + 캐스팅을 달력에 뿌리기 좋게 묶어서 반환 */
export interface ShowtimeWithCast extends ShowtimeRow {
  actors: string[];
}

export function listShowtimesWithCast(showId: string): ShowtimeWithCast[] {
  const times = listShowtimes(showId);
  const casts = rows<{ showtime_id: number; actor: string }>(
    `SELECT c.showtime_id, c.actor FROM castings c
     JOIN showtimes s ON s.id = c.showtime_id
     WHERE s.show_id=? ORDER BY c.rowid`,
    showId,
  );

  const byId = new Map<number, string[]>();
  for (const c of casts) {
    const list = byId.get(c.showtime_id) ?? [];
    list.push(c.actor);
    byId.set(c.showtime_id, list);
  }

  return times.map((t) => ({ ...t, actors: byId.get(t.id) ?? [] }));
}

/* ------------------------------ 오늘의 공연 ------------------------------- */

export interface TodayEntry {
  showtimeId: number;
  showId: string;
  showName: string;
  genre: string | null;
  facility: string | null;
  poster: string | null;
  time: string;
  note: string | null;
  actors: string[];
}

export function listByDate(date: string, onlyTracked = false): TodayEntry[] {
  const list = rows<{
    id: number; show_id: string; time: string; note: string | null;
    name: string; genre: string | null; facility: string | null; poster: string | null;
  }>(
    `SELECT st.id, st.show_id, st.time, st.note,
            s.name, s.genre, s.facility, s.poster
     FROM showtimes st JOIN shows s ON s.id = st.show_id
     WHERE st.date = ? ${onlyTracked ? "AND s.tracked = 1" : ""}
     ORDER BY st.time, s.name`,
    date,
  );

  const casts = rows<{ showtime_id: number; actor: string }>(
    `SELECT c.showtime_id, c.actor FROM castings c
     JOIN showtimes st ON st.id = c.showtime_id
     WHERE st.date = ? ORDER BY c.rowid`,
    date,
  );

  const byId = new Map<number, string[]>();
  for (const c of casts) {
    const l = byId.get(c.showtime_id) ?? [];
    l.push(c.actor);
    byId.set(c.showtime_id, l);
  }

  return list.map((r) => ({
    showtimeId: r.id,
    showId: r.show_id,
    showName: r.name,
    genre: r.genre,
    facility: r.facility,
    poster: r.poster,
    time: r.time,
    note: r.note,
    actors: byId.get(r.id) ?? [],
  }));
}

/* -------------------------------- 애배 ----------------------------------- */

export function listFavoriteActors() {
  return rows<{ name: string }>("SELECT name FROM favorite_actors ORDER BY created_at DESC")
    .map((r) => r.name);
}

export function addFavoriteActor(name: string) {
  run(
    "INSERT OR IGNORE INTO favorite_actors (name, created_at) VALUES (?, datetime('now'))",
    name.trim(),
  );
}

export function removeFavoriteActor(name: string) {
  run("DELETE FROM favorite_actors WHERE name=?", name);
}

/** 애배가 출연하는 앞으로의 회차 */
export function listFavoriteActorShowtimes(fromDate: string) {
  return rows<{
    actor: string; date: string; time: string;
    show_id: string; show_name: string; facility: string | null;
  }>(
    `SELECT c.actor, st.date, st.time, s.id AS show_id, s.name AS show_name, s.facility
     FROM castings c
     JOIN showtimes st ON st.id = c.showtime_id
     JOIN shows s ON s.id = st.show_id
     WHERE c.actor IN (SELECT name FROM favorite_actors) AND st.date >= ?
     ORDER BY st.date, st.time`,
    fromDate,
  );
}

/** 특정 배우의 출연 회차 (배우별 상세용) */
export function listActorShowtimes(actor: string) {
  return rows<{
    date: string; time: string; show_id: string; show_name: string; facility: string | null;
  }>(
    `SELECT st.date, st.time, s.id AS show_id, s.name AS show_name, s.facility
     FROM castings c
     JOIN showtimes st ON st.id = c.showtime_id
     JOIN shows s ON s.id = st.show_id
     WHERE c.actor = ? ORDER BY st.date, st.time`,
    actor,
  );
}

/* ------------------------------- 내 달력 ---------------------------------- */

export function listMySchedule() {
  return rows<{
    id: number; show_id: string; date: string; time: string;
    seat: string | null; memo: string | null; show_name: string; facility: string | null;
  }>(
    `SELECT m.id, m.show_id, m.date, m.time, m.seat, m.memo,
            s.name AS show_name, s.facility
     FROM my_schedule m JOIN shows s ON s.id = m.show_id
     ORDER BY m.date, m.time`,
  );
}

export function addMySchedule(showId: string, date: string, time: string, seat?: string, memo?: string) {
  run(
    `INSERT INTO my_schedule (show_id, date, time, seat, memo, created_at)
     VALUES (?,?,?,?,?,datetime('now'))
     ON CONFLICT(show_id, date, time) DO UPDATE SET seat=excluded.seat, memo=excluded.memo`,
    showId, date, time, seat ?? null, memo ?? null,
  );
}

export function removeMySchedule(id: number) {
  run("DELETE FROM my_schedule WHERE id=?", id);
}
