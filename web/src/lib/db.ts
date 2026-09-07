import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

// Next.js dev 모드는 모듈을 여러 번 평가하므로 전역에 한 번만 물려둔다.
const g = globalThis as unknown as { __db?: DatabaseSync };

function open(): DatabaseSync {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(path.join(dir, "app.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    -- KOPIS에서 받아오는 공연 마스터 데이터
    CREATE TABLE IF NOT EXISTS shows (
      id             TEXT PRIMARY KEY,        -- KOPIS mt20id (예: PF132236)
      name           TEXT NOT NULL,
      genre          TEXT,
      poster         TEXT,
      area           TEXT,
      start_date     TEXT,                    -- YYYY-MM-DD
      end_date       TEXT,
      facility       TEXT,
      facility_id    TEXT,
      state          TEXT,                    -- 공연예정 / 공연중 / 공연완료
      runtime        TEXT,
      age            TEXT,
      price          TEXT,
      cast_raw       TEXT,                    -- KOPIS prfcast (쉼표로 나열된 전체 출연진)
      crew_raw       TEXT,                    -- KOPIS prfcrew
      company        TEXT,
      story          TEXT,
      time_guidance  TEXT,                    -- KOPIS dtguidance (요일별 공연시간 안내)
      detail_synced  INTEGER NOT NULL DEFAULT 0,
      tracked        INTEGER NOT NULL DEFAULT 0,  -- 내가 챙겨보는 공연
      synced_at      TEXT
    );

    -- 회차 (날짜 + 시간). KOPIS의 요일 패턴에서 생성하거나 직접 추가한다.
    CREATE TABLE IF NOT EXISTS showtimes (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id  TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      date     TEXT NOT NULL,                 -- YYYY-MM-DD
      time     TEXT NOT NULL,                 -- HH:MM
      note     TEXT,                          -- 스페셜 커튼콜, 관크 주의 등 메모
      UNIQUE(show_id, date, time)
    );

    -- 회차별 실제 캐스팅. KOPIS에 없는 정보라 추출/직접입력으로 채운다.
    CREATE TABLE IF NOT EXISTS castings (
      showtime_id INTEGER NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
      actor       TEXT NOT NULL,
      role        TEXT,
      UNIQUE(showtime_id, actor)
    );

    -- 배역별 배우 풀 (이 작품에서 A역을 맡는 배우들)
    CREATE TABLE IF NOT EXISTS roles (
      show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      role    TEXT NOT NULL,
      actor   TEXT NOT NULL,
      ord     INTEGER NOT NULL DEFAULT 0,
      UNIQUE(show_id, role, actor)
    );

    -- 애배(관심 배우)
    CREATE TABLE IF NOT EXISTS favorite_actors (
      name       TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    -- 내 달력 (내가 예매한 회차)
    CREATE TABLE IF NOT EXISTS my_schedule (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id     TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      time        TEXT NOT NULL,
      seat        TEXT,
      memo        TEXT,
      created_at  TEXT NOT NULL,
      UNIQUE(show_id, date, time)
    );

    CREATE INDEX IF NOT EXISTS idx_showtimes_date    ON showtimes(date);
    CREATE INDEX IF NOT EXISTS idx_showtimes_show    ON showtimes(show_id, date);
    CREATE INDEX IF NOT EXISTS idx_castings_actor    ON castings(actor);
    CREATE INDEX IF NOT EXISTS idx_shows_dates       ON shows(start_date, end_date);
  `);
}

export function db(): DatabaseSync {
  if (!g.__db) g.__db = open();
  return g.__db;
}
