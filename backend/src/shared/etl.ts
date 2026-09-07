/**
 * 모듈 ②·③이 공유하는 ETL 계약.
 *
 *   Extract   사이트마다 방식이 다르다 (예매처=Playwright 캡처, X=신디케이션 JSON)
 *      ↓      하지만 산출물은 ExtractedBundle 하나로 통일한다
 *   Transform 전부 동일하게 `claude -p`로 판독한다 (shared/claude.ts)
 *      ↓      산출물은 모듈별 zod 스키마로 검증된 JSON
 *   Load      DB INSERT
 *
 * Extract를 통일해 두는 이유: Transform 단계가 "어느 사이트에서 왔는지" 몰라도 되게 하려는 것이다.
 * 새 예매처가 늘어나도 Transform은 손대지 않는다.
 */

export type SourceKind = "nol" | "ticketlink" | "interpark" | "yes24" | "melon" | "x";

/** Extract 단계(2-1 / 3-1)의 산출물. Transform(2-2 / 3-2)의 유일한 입력이다. */
export interface ExtractedBundle {
  source: SourceKind;
  /**
   * 중복 방지 키. 두 번 판독하지 않기 위한 것이다.
   *   X       → status ID
   *   예매처   → 상세페이지 URL (또는 공연ID)
   */
  sourceId: string;
  /** 원본 위치 */
  url: string;
  /** 수집 시각 ISO */
  fetchedAt: string;
  /** 원본에 게시/갱신된 시각 ISO. 모르면 null */
  postedAt: string | null;
  /** 텍스트로 확보된 내용. 없으면 빈 문자열 */
  text: string;
  /** 로컬에 떨어뜨린 이미지 경로. Transform이 Read 툴로 읽는다 */
  imagePaths: string[];
  /** 원본 이미지 URL (보관용) */
  imageUrls: string[];
  /** 모듈별 부가 정보 (공연명, 계정 handle 등) */
  meta: Record<string, string>;
}

/** Transform 결과에 공통으로 붙는 출처 정보. 어느 원본에서 나온 값인지 추적한다. */
export interface TransformResult<T> {
  source: SourceKind;
  sourceId: string;
  url: string;
  transformedAt: string;
  data: T;
  warnings: string[];
}

export function wrap<T>(
  bundle: ExtractedBundle,
  data: T,
  warnings: string[] = [],
): TransformResult<T> {
  return {
    source: bundle.source,
    sourceId: bundle.sourceId,
    url: bundle.url,
    transformedAt: new Date().toISOString(),
    data,
    warnings,
  };
}

/** 이미 처리한 sourceId를 빼고 새 것만 남긴다. Load 계층이 붙기 전까지는 호출부가 집합을 넘긴다. */
export function onlyNew(
  bundles: ExtractedBundle[],
  seen: ReadonlySet<string>,
): ExtractedBundle[] {
  return bundles.filter((b) => !seen.has(b.sourceId));
}
