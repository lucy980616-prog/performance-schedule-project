/**
 * Load 단계 — 3-1/3-2에서 나온 이벤트를 backend/data/collector.db 에 쓴다.
 *
 * ticket-casting/load.ts 와 마찬가지로 이 모듈만 SQL을 안다.
 */
import { db } from "../../shared/db.ts";
import * as log from "../../shared/log.ts";
import type { TransformResult } from "../../shared/etl.ts";
import type { EventExtraction } from "./schema.ts";

export interface SnsAccountRow {
  handle: string;
  label: string | null;
  enabled: number;
  last_seen_id: string | null;
  last_run_at: string | null;
}

export function upsertAccount(handle: string, label?: string | null): void {
  db().prepare(`
    INSERT INTO sns_accounts (handle, label, enabled)
    VALUES (?, ?, 1)
    ON CONFLICT(handle) DO UPDATE SET label = COALESCE(excluded.label, sns_accounts.label)
  `).run(handle, label ?? null);
}

export function getAccount(handle: string): SnsAccountRow | undefined {
  return db().prepare(`SELECT * FROM sns_accounts WHERE handle = ?`).get(handle) as
    | SnsAccountRow
    | undefined;
}

export function listEnabledAccounts(): SnsAccountRow[] {
  return db().prepare(`SELECT * FROM sns_accounts WHERE enabled = 1`).all() as unknown as SnsAccountRow[];
}

export function updateLastSeen(handle: string, lastSeenId: string): void {
  db()
    .prepare(`UPDATE sns_accounts SET last_seen_id = ?, last_run_at = ? WHERE handle = ?`)
    .run(lastSeenId, new Date().toISOString(), handle);
}

/**
 * 게시물 하나의 판독 결과(여러 이벤트일 수 있다)를 저장한다.
 * showName이 있으면 shows.name과 느슨하게(부분일치) 매칭해 show_id를 채운다 —
 * 실패해도 이벤트 자체는 저장한다. 매칭은 어디까지나 편의용이지 신뢰할 근거는 아니다.
 */
export function saveEvents(
  handle: string,
  results: TransformResult<EventExtraction>[],
): { saved: number } {
  const database = db();
  const insert = database.prepare(`
    INSERT INTO events
      (post_id, handle, url, posted_at, kind, title, show_name, show_id, date, time, description, confidence, collected_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(post_id, title) DO UPDATE SET
      kind = excluded.kind, date = excluded.date, time = excluded.time,
      description = excluded.description, confidence = excluded.confidence
  `);
  const findShowId = database.prepare(
    `SELECT id FROM shows WHERE name LIKE '%' || ? || '%' OR ? LIKE '%' || name || '%' LIMIT 1`,
  );

  let saved = 0;
  const now = new Date().toISOString();

  for (const r of results) {
    for (const ev of r.data.events) {
      let showId: number | null = null;
      if (ev.showName) {
        const match = findShowId.get(ev.showName, ev.showName) as { id: number } | undefined;
        showId = match?.id ?? null;
      }

      insert.run(
        r.sourceId,
        handle,
        r.url,
        r.transformedAt,
        ev.kind,
        ev.title,
        ev.showName,
        showId,
        ev.date,
        ev.time,
        ev.description,
        ev.confidence,
        now,
      );
      saved++;
    }
  }

  log.info("x-events", `@${handle} 이벤트 ${saved}건 저장`);
  return { saved };
}
