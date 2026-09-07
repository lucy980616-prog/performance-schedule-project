/**
 * 모듈 ③ X 이벤트 — 커튼콜·팬사인·할인 같은 "공식 API에 절대 없는" 정보
 *
 *   3-1 Extract    syndication.ts (주 경로, 로그인·브라우저 불필요)
 *                  playwright.ts  (폴백)
 *                  extract.ts     둘을 고르고 이미지를 받아 ExtractedBundle 완성
 *   3-2 Transform  transform.ts   claude -p 로 본문+이미지 → 이벤트 JSON
 *   Load           load.ts        sns_accounts/events 저장 (backend/data/collector.db)
 *   schema.ts      zod 스키마
 */
export * from "./schema.ts";
export * from "./syndication.ts";
export * from "./playwright.ts";
export * from "./extract.ts";
export * from "./transform.ts";
export * from "./load.ts";
