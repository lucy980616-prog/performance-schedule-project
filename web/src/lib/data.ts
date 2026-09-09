import { supabase } from "@/lib/supabase";
import { todayISO } from "@/lib/utils";

/**
 * Supabase 조회 계층. `web/`은 읽기 전용 — 쓰기는 애배/내 캐스팅 표시 정도만 브라우저에서
 * 직접 하고, 그 외 데이터는 전부 `backend/` 수집기가 service_role 키로 채운다.
 *
 * 데이터가 많지 않아(공연 수백 건 수준) 페이지별로 필요한 테이블을 통째로 불러온 뒤
 * 필터/정렬은 클라이언트에서 처리한다 — 쿼리스트링 기반 서버 필터링은
 * 정적 export(GitHub Pages)에서 요청 시점 searchParams를 쓸 수 없기 때문이다.
 */

export interface ShowRow {
  id: number;
  source: string;
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
  tracked: boolean;
  state: "공연예정" | "공연중" | "공연완료" | null;
}

function withState(row: Omit<ShowRow, "state">): ShowRow {
  const today = todayISO();
  let state: ShowRow["state"] = null;
  if (row.start_date && row.end_date) {
    if (today < row.start_date) state = "공연예정";
    else if (today <= row.end_date) state = "공연중";
    else state = "공연완료";
  }
  return { ...row, state };
}

export async function fetchAllShows(): Promise<ShowRow[]> {
  const { data, error } = await supabase
    .from("shows")
    .select(
      "id, source, name, genre, start_date, end_date, venue, address, price, organizer, cast_raw, poster, url, tracked",
    );
  if (error) throw error;
  return (data ?? []).map(withState).sort((a, b) => {
    if (a.state === "공연중" && b.state !== "공연중") return -1;
    if (b.state === "공연중" && a.state !== "공연중") return 1;
    return (a.start_date ?? "").localeCompare(b.start_date ?? "");
  });
}

export async function fetchShow(id: number): Promise<ShowRow | null> {
  const { data, error } = await supabase
    .from("shows")
    .select(
      "id, source, name, genre, start_date, end_date, venue, address, price, organizer, cast_raw, poster, url, tracked",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? withState(data) : null;
}

export async function fetchAllShowIds(): Promise<number[]> {
  const { data, error } = await supabase.from("shows").select("id");
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

/* --------------------------------- 회차 ---------------------------------- */

export interface ShowtimeRow {
  id: number;
  show_id: number;
  date: string;
  time: string;
  note: string | null;
}

export interface ShowtimeWithCast extends ShowtimeRow {
  actors: string[];
}

export async function fetchShowtimesWithCast(showId: number): Promise<ShowtimeWithCast[]> {
  const { data: times, error: e1 } = await supabase
    .from("showtimes")
    .select("id, show_id, date, time, note")
    .eq("show_id", showId)
    .order("date")
    .order("time");
  if (e1) throw e1;

  const ids = (times ?? []).map((t) => t.id);
  const byId = new Map<number, string[]>();
  if (ids.length > 0) {
    const { data: casts, error: e2 } = await supabase
      .from("castings")
      .select("showtime_id, actor")
      .in("showtime_id", ids)
      .order("id");
    if (e2) throw e2;
    for (const c of casts ?? []) {
      const list = byId.get(c.showtime_id) ?? [];
      list.push(c.actor);
      byId.set(c.showtime_id, list);
    }
  }

  return (times ?? []).map((t) => ({ ...t, actors: byId.get(t.id) ?? [] }));
}

/* -------------------------------- 배역 ------------------------------------ */

export async function fetchRoles(showId: number) {
  const { data, error } = await supabase
    .from("roles")
    .select("role, actor, ord")
    .eq("show_id", showId)
    .order("ord")
    .order("role")
    .order("actor");
  if (error) throw error;
  return data ?? [];
}

/* ------------------------------ 오늘의 공연 -------------------------------- */

export interface TodayEntry {
  showtimeId: number;
  showId: number;
  showName: string;
  genre: string | null;
  venue: string | null;
  poster: string | null;
  time: string;
  note: string | null;
  actors: string[];
}

export async function fetchByDate(date: string): Promise<TodayEntry[]> {
  const { data: sts, error: e1 } = await supabase
    .from("showtimes")
    .select("id, time, note, shows(id, name, genre, venue, poster)")
    .eq("date", date)
    .order("time");
  if (e1) throw e1;

  const ids = (sts ?? []).map((s) => s.id);
  const byId = new Map<number, string[]>();
  if (ids.length > 0) {
    const { data: casts, error: e2 } = await supabase
      .from("castings")
      .select("showtime_id, actor")
      .in("showtime_id", ids)
      .order("id");
    if (e2) throw e2;
    for (const c of casts ?? []) {
      const list = byId.get(c.showtime_id) ?? [];
      list.push(c.actor);
      byId.set(c.showtime_id, list);
    }
  }

  return (sts ?? [])
    .filter((s) => s.shows)
    .map((s) => {
      const show = s.shows as unknown as {
        id: number;
        name: string;
        genre: string | null;
        venue: string | null;
        poster: string | null;
      };
      return {
        showtimeId: s.id,
        showId: show.id,
        showName: show.name,
        genre: show.genre,
        venue: show.venue,
        poster: show.poster,
        time: s.time,
        note: s.note,
        actors: byId.get(s.id) ?? [],
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time) || a.showName.localeCompare(b.showName));
}

/* -------------------------------- 애배 ------------------------------------ */

export async function fetchFavoriteActors(): Promise<string[]> {
  const { data, error } = await supabase
    .from("favorite_actors")
    .select("name")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => r.name);
}

export async function addFavoriteActor(name: string) {
  const { error } = await supabase.from("favorite_actors").upsert({ name: name.trim() });
  if (error) throw error;
}

export async function removeFavoriteActor(name: string) {
  const { error } = await supabase.from("favorite_actors").delete().eq("name", name);
  if (error) throw error;
}

export interface ActorShowtime {
  date: string;
  time: string;
  show_id: number;
  show_name: string;
  venue: string | null;
}

export async function fetchActorShowtimes(actor: string): Promise<ActorShowtime[]> {
  const { data, error } = await supabase
    .from("castings")
    .select("showtimes(date, time, shows(id, name, venue))")
    .eq("actor", actor);
  if (error) throw error;

  return (data ?? [])
    .map((r) => r.showtimes as unknown as {
      date: string;
      time: string;
      shows: { id: number; name: string; venue: string | null } | null;
    })
    .filter((s): s is NonNullable<typeof s> => !!s && !!s.shows)
    .map((s) => ({
      date: s.date,
      time: s.time,
      show_id: s.shows!.id,
      show_name: s.shows!.name,
      venue: s.shows!.venue,
    }))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

export async function fetchAllActorNames(): Promise<string[]> {
  const { data, error } = await supabase.from("castings").select("actor");
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.actor))];
}

export interface FavoriteActorShowtime extends ActorShowtime {
  actor: string;
}

export async function fetchFavoriteActorShowtimes(fromDate: string): Promise<FavoriteActorShowtime[]> {
  const favorites = await fetchFavoriteActors();
  if (favorites.length === 0) return [];

  const { data, error } = await supabase
    .from("castings")
    .select("actor, showtimes(date, time, shows(id, name, venue))")
    .in("actor", favorites);
  if (error) throw error;

  return (data ?? [])
    .map((r) => ({
      actor: r.actor,
      st: r.showtimes as unknown as {
        date: string;
        time: string;
        shows: { id: number; name: string; venue: string | null } | null;
      } | null,
    }))
    .filter((r) => r.st && r.st.shows && r.st.date >= fromDate)
    .map((r) => ({
      actor: r.actor,
      date: r.st!.date,
      time: r.st!.time,
      show_id: r.st!.shows!.id,
      show_name: r.st!.shows!.name,
      venue: r.st!.shows!.venue,
    }))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/* ------------------------------- 내 달력 ---------------------------------- */

export interface MyScheduleItem {
  id: number;
  show_id: number;
  date: string;
  time: string;
  seat: string | null;
  memo: string | null;
  show_name: string;
  venue: string | null;
}

export async function fetchMySchedule(): Promise<MyScheduleItem[]> {
  const { data, error } = await supabase
    .from("my_schedule")
    .select("id, date, time, seat, memo, shows(id, name, venue)")
    .order("date")
    .order("time");
  if (error) throw error;

  return (data ?? [])
    .map((r) => {
      const show = r.shows as unknown as { id: number; name: string; venue: string | null } | null;
      if (!show) return null;
      return {
        id: r.id,
        show_id: show.id,
        date: r.date,
        time: r.time,
        seat: r.seat,
        memo: r.memo,
        show_name: show.name,
        venue: show.venue,
      };
    })
    .filter((r): r is MyScheduleItem => r !== null);
}
