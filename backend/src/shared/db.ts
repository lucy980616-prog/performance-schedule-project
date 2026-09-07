import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

/**
 * 수집기 저장소 (Load 단계).
 *
 * web/src/lib/db.ts 와 같은 방식(node:sqlite, 파일 하나)이지만 별도 파일이다 —
 * 수집기와 웹앱은 서로의 코드를 import하지 않는다는 원칙(§0)을 DB에도 적용했다.
 * 웹 연동 시점에 이 파일의 내용을 web/data/app.db 로 옮기거나 Supabase로 이관한다.
 *
 * 스키마는 docs/03-final-architecture-plan.md §3 의 Postgres 스키마를 SQLite로 옮긴 것.
 * KOPIS가 막혀 있는 지금은 shows.source/source_id 가 발견 경로를 기록한다
 * (nol / yes24 / ticketlink / manual — KOPIS가 복구되면 "kopis"도 추가된다).
 */

const g = globalThis as unknown as { __collectorDb?: DatabaseSync };

function open(): DatabaseSync {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(path.join(dir, "collector.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    -- 공연. KOPIS 대신 예매처 상세페이지에서 발견·수집한다.
    CREATE TABLE IF NOT EXISTS shows (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      source         TEXT NOT NULL,              -- 'nol' | 'yes24' | 'ticketlink' | 'manual'
      source_id      TEXT NOT NULL,               -- 예매처 상품ID (nol: goodsCode, yes24/ticketlink: idPerf/productId)
      name           TEXT NOT NULL,
      genre          TEXT,                        -- 'musical' | 'play' | 기타 — 콘서트 등은 애초에 수집 안 함
      start_date     TEXT,                        -- YYYY-MM-DD
      end_date       TEXT,
      venue          TEXT,
      address        TEXT,
      price          INTEGER,
      organizer      TEXT,
      cast_raw       TEXT,                        -- 예매처가 주는 작품 전체 출연진 (회차별 아님)
      poster         TEXT,
      url            TEXT,
      discovered_at  TEXT NOT NULL,
      synced_at      TEXT,
      UNIQUE(source, source_id)
    );

    -- 회차 (날짜 + 시간)
    CREATE TABLE IF NOT EXISTS showtimes (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id  INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      date     TEXT NOT NULL,
      time     TEXT NOT NULL,
      note     TEXT,                              -- 첫공/막공/사인회/스페셜 커튼콜 등
      UNIQUE(show_id, date, time)
    );

    -- 회차별 캐스팅. nol은 구조화 API로, yes24는 claude -p 판독으로 채운다.
    CREATE TABLE IF NOT EXISTS castings (
      showtime_id INTEGER NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
      actor       TEXT NOT NULL,
      role        TEXT,
      source      TEXT NOT NULL,                  -- 'nol-api' | 'claude-p' | 'manual'
      UNIQUE(showtime_id, actor)
    );

    -- 배역별 배우 풀
    CREATE TABLE IF NOT EXISTS roles (
      show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      role    TEXT NOT NULL,
      actor   TEXT NOT NULL,
      ord     INTEGER NOT NULL DEFAULT 0,
      UNIQUE(show_id, role, actor)
    );

    -- 추적하는 X 계정
    CREATE TABLE IF NOT EXISTS sns_accounts (
      handle       TEXT PRIMARY KEY,
      label        TEXT,
      enabled      INTEGER NOT NULL DEFAULT 1,
      last_seen_id TEXT,                          -- 마지막으로 처리한 status ID (중복 방지)
      last_run_at  TEXT
    );

    -- X 게시물에서 뽑아낸 이벤트 (커튼콜/팬사인/할인/캐스팅변경 등)
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id     TEXT NOT NULL,                  -- X status ID
      handle      TEXT NOT NULL,
      url         TEXT NOT NULL,
      posted_at   TEXT,
      kind        TEXT,
      title       TEXT NOT NULL,
      show_name   TEXT,
      show_id     INTEGER REFERENCES shows(id),    -- 매칭되면 연결. 안 되면 NULL
      date        TEXT,
      time        TEXT,
      description TEXT,
      confidence  REAL,
      collected_at TEXT NOT NULL,
      UNIQUE(post_id, title)
    );

    CREATE INDEX IF NOT EXISTS idx_showtimes_show  ON showtimes(show_id, date);
    CREATE INDEX IF NOT EXISTS idx_castings_actor  ON castings(actor);
    CREATE INDEX IF NOT EXISTS idx_shows_dates     ON shows(start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_events_handle   ON events(handle, posted_at);
  `);
}

export function db(): DatabaseSync {
  if (!g.__collectorDb) g.__collectorDb = open();
  return g.__collectorDb;
}

export function closeDb() {
  if (g.__collectorDb) {
    g.__collectorDb.close();
    g.__collectorDb = undefined;
  }
}
