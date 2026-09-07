/**
 * 수집기 로그. 조용한 실패가 제일 나쁘므로, 실패는 반드시 남기고 위로 던진다.
 */
const stamp = () => new Date().toISOString().slice(11, 19);

export function info(scope: string, msg: string, extra?: unknown) {
  console.log(`[${stamp()}] ${scope}: ${msg}`, extra ?? "");
}

export function warn(scope: string, msg: string, extra?: unknown) {
  console.warn(`[${stamp()}] ${scope}: ⚠ ${msg}`, extra ?? "");
}

export function fail(scope: string, msg: string, extra?: unknown) {
  console.error(`[${stamp()}] ${scope}: ✖ ${msg}`, extra ?? "");
}
