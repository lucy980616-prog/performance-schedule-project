/**
 * 모듈 ② 예매처 캐스팅 — KOPIS에 없는 "회차별 누가 나오는지"
 *
 * KOPIS 신규 발급이 막혀 있는 동안(→ README, docs §9) **발견(discovery)도 이 모듈이 맡는다.**
 * NOL 장르 목록(연극/뮤지컬만, 콘서트 등은 URL 자체가 갈려서 자동 제외)이 KOPIS의 대체 출발점이다.
 *
 *   2-1 Extract
 *     nol.ts         NOL(인터파크) — 장르 목록으로 발견 + 회차별 캐스팅까지 구조화 JSON ← 주력
 *     yes24.ts       예스24 — JSON-LD 상세 + 캐스팅표 이미지
 *     ticketlink.ts  티켓링크 — JSON-LD 상세만 (회차별 캐스팅은 WAF에 막혀 못 얻음)
 *     discover.ts    (레거시) KOPIS 공연명 → 예매처 URL 검색. KOPIS 없이는 출발점이 없다.
 *     extract.ts     (레거시) discover.ts 결과를 Playwright로 캡처. 인터파크/예스24/멜론 범용 — 미검증
 *   2-2 Transform
 *     transform.ts   claude -p 로 이미지 판독 → 회차별 캐스팅 JSON (nol.ts는 이 단계를 건너뛴다)
 *   Load
 *     load.ts        showtimes/castings/roles 저장 (backend/data/collector.db)
 *   schema.ts        zod 스키마 + 형식 검증
 *
 * ticketlink.ts/nol.ts/yes24.ts 는 각자 `toBundle`을 내보내므로 이름이 겹친다.
 * 그래서 이 셋은 네임스페이스로 다시 내보낸다: `import { nol, yes24, ticketlink } from "./index.ts"`
 */
export * from "./schema.ts";
export * from "./discover.ts";
export * from "./extract.ts";
export * from "./transform.ts";
export * from "./load.ts";

export * as ticketlink from "./ticketlink.ts";
export * as nol from "./nol.ts";
export * as yes24 from "./yes24.ts";
