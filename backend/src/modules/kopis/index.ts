/**
 * 모듈 ① KOPIS — 공연 마스터 데이터
 *
 * 공식 오픈API라서 스크래핑도 AI 추출도 필요 없다. 이 모듈은 순수하게 fetch + XML 파싱이다.
 * KOPIS가 주지 않는 것: **회차별 캐스팅** → 모듈 ②가 채운다.
 *
 * 출처 명시 의무: 출처: (재)예술경영지원센터 공연예술통합전산망(www.kopis.or.kr)
 */
export * from "./client.ts";
export { syncShows, type SyncResult } from "./sync.ts";
