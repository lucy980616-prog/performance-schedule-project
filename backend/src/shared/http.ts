import http2 from "node:http2";

/**
 * HTTP/2 GET.
 *
 * 왜 fetch를 안 쓰는가 — 2026-09-07 실측:
 *   syndication.twitter.com 은 Node 내장 fetch(undici)로 요청하면 헤더를 어떻게 맞춰도
 *   **무조건 429**를 돌려준다. 같은 시각 같은 IP에서 curl과 node:http2 는 200 (570KB).
 *   즉 IP 레이트 리밋이 아니라 undici 자체가 걸러지는 것이다.
 *   헤더 조합(Accept / Sec-Fetch-* / Accept-Language)을 4가지 시도했지만 전부 429였다.
 *
 * 그래서 X 계열 요청은 이 함수를 쓴다. 외부 의존성 없이 내장 모듈만 쓴다.
 */

export interface Http2Response {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export function http2Get(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 30_000,
): Promise<Http2Response> {
  const u = new URL(url);

  return new Promise((resolve, reject) => {
    const session = http2.connect(u.origin);
    const chunks: Buffer[] = [];
    let status = 0;
    let resHeaders: Record<string, string> = {};
    let settled = false;

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.close();
      fn();
    };

    const timer = setTimeout(
      () => done(() => reject(new Error(`http2 timeout ${timeoutMs}ms: ${url}`))),
      timeoutMs,
    );

    session.on("error", (err) => done(() => reject(err)));

    const req = session.request({
      ":method": "GET",
      ":path": `${u.pathname}${u.search}`,
      ...headers,
    });

    req.on("response", (h) => {
      status = Number(h[":status"] ?? 0);
      resHeaders = Object.fromEntries(
        Object.entries(h)
          .filter(([k]) => !k.startsWith(":"))
          .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v ?? "")]),
      );
    });
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("error", (err) => done(() => reject(err)));
    req.on("end", () =>
      done(() => resolve({ status, headers: resHeaders, body: Buffer.concat(chunks) })),
    );

    req.end();
  });
}

export async function http2GetText(
  url: string,
  headers?: Record<string, string>,
  timeoutMs?: number,
): Promise<Http2Response & { text: string }> {
  const res = await http2Get(url, headers, timeoutMs);
  return { ...res, text: res.body.toString("utf8") };
}
