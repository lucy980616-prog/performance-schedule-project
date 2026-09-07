/**
 * 요청 간 간격. X와 예매처는 순차 처리 + 3초 이상 간격이 원칙이다.
 * (docs/03-final-architecture-plan.md §2 ③)
 */
export const POLITE_DELAY_MS = 3_000;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const politeSleep = () => sleep(POLITE_DELAY_MS);
