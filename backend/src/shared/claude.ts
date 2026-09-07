import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";

/**
 * `claude -p` (Claude Code CLI non-interactive 모드) 래퍼.
 *
 * 개발 중에는 Anthropic API를 직접 호출하지 않는다. 이미 설치·로그인된 CLI를
 * 자식 프로세스로 띄워서 쓴다 — 별도 API 키도, 별도 과금도 없다.
 *
 * 전송 수단은 이 파일 하나에 가둔다. 호출부는 자기가 CLI를 쓰는지 API를 쓰는지 몰라야 한다.
 * 나중에 API로 옮길 때 이 파일 내부만 갈아끼우면 된다.
 */

const DEFAULT_TIMEOUT_MS = 300_000;

/** `--output-format json`이 돌려주는 바깥 봉투. 모델이 만든 JSON은 result 안에 문자열로 들어 있다. */
interface ResultEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
}

export class ClaudeCliError extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = "ClaudeCliError";
    this.detail = detail;
  }
}

/**
 * 실행 파일을 찾는다.
 *
 * Windows에서 PATH에 잡히는 `claude.cmd`는 배치 샤임이라 shell 없이는 spawn되지 않는다
 * (spawn EINVAL). 다행히 패키지 안에 진짜 실행 파일 `bin/claude.exe`가 있으므로 그걸 직접 쓴다.
 * shell을 끼우지 않아야 여러 줄짜리 시스템 프롬프트를 인자로 안전하게 넘길 수 있다.
 */
function bin(): string {
  const override = process.env.CLAUDE_BIN;
  if (override) return override;
  if (process.platform !== "win32") return "claude";

  const rel = path.join("@anthropic-ai", "claude-code", "bin", "claude.exe");
  const candidates = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", rel) : null,
    path.join(process.cwd(), "node_modules", rel),
  ].filter((c): c is string => c !== null);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // 못 찾으면 PATH에 맡긴다. 실패하면 spawnCollect가 안내 메시지를 낸다.
  return "claude.cmd";
}

export interface RunClaudeOptions {
  /** --append-system-prompt 로 전달 */
  system: string;
  /** 프롬프트 본문. 인자로 넘기면 길이·따옴표 문제가 생기므로 stdin으로 넣는다. */
  prompt: string;
  /** 있으면 Read 툴을 허용한다. 경로는 호출부가 프롬프트에 넣어 둘 것. */
  allowRead?: boolean;
  /** 'opus' | 'sonnet' | 'haiku' 또는 전체 모델명. 기본 opus */
  model?: string;
  timeoutMs?: number;
}

/** CLI를 한 번 실행하고 모델이 낸 텍스트(봉투의 result)를 돌려준다. */
export async function runClaude(opts: RunClaudeOptions): Promise<string> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--append-system-prompt",
    opts.system,
    "--model",
    opts.model ?? process.env.CLAUDE_MODEL ?? "opus",
    // 쓰기·네트워크 툴은 전부 막는다. 수집기가 임의로 파일을 건드리면 안 된다.
    "--disallowed-tools",
    "Bash",
    "Edit",
    "Write",
    "WebFetch",
    "WebSearch",
  ];
  if (opts.allowRead) args.push("--allowed-tools", "Read");

  const raw = await spawnCollect(bin(), args, opts.prompt, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let env: ResultEnvelope;
  try {
    env = JSON.parse(raw.stdout) as ResultEnvelope;
  } catch {
    throw new ClaudeCliError(
      "claude -p 출력이 JSON 봉투가 아닙니다. CLI 버전이나 로그인 상태를 확인하세요.",
      raw.stdout.slice(0, 2000) || raw.stderr.slice(0, 2000),
    );
  }

  if (env.is_error || typeof env.result !== "string") {
    throw new ClaudeCliError(
      `claude -p 실행 실패 (subtype=${env.subtype ?? "?"})`,
      JSON.stringify(env).slice(0, 2000),
    );
  }

  return env.result;
}

/**
 * 프롬프트를 넣으면 **스키마 검증을 통과한** JSON을 돌려준다.
 *
 * SDK의 structured output과 달리 CLI는 스키마 준수를 보장하지 않는다.
 * 그래서 파싱 결과를 항상 zod로 검증하고, 실패하면 무엇이 틀렸는지 알려주고 딱 1회 재시도한다.
 */
export async function runClaudeJson<T>(
  opts: RunClaudeOptions & { schema: ZodType<T> },
): Promise<T> {
  const withJsonRule = [
    opts.system,
    "",
    "출력 규칙:",
    "- 오직 JSON 하나만 출력하세요. 설명, 인사말, 코드펜스를 붙이지 마세요.",
    "- 값을 모르면 추측하지 말고 스키마가 허용하는 빈 값(null 또는 빈 배열)을 쓰세요.",
  ].join("\n");

  let lastText = "";
  let lastIssue = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? opts.prompt
        : [
            opts.prompt,
            "",
            "── 직전 응답이 스키마에 맞지 않았습니다. 아래 문제를 고쳐서 JSON만 다시 출력하세요.",
            lastIssue,
          ].join("\n");

    lastText = await runClaude({ ...opts, system: withJsonRule, prompt });

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFence(lastText));
    } catch (err) {
      lastIssue = `JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }

    const result = opts.schema.safeParse(parsed);
    if (result.success) return result.data;

    lastIssue = result.error.issues
      .slice(0, 10)
      .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
  }

  throw new ClaudeCliError(
    `claude -p 응답이 두 번 모두 스키마 검증에 실패했습니다.\n${lastIssue}`,
    lastText.slice(0, 2000),
  );
}

/** 모델이 ```json 펜스를 붙여 오는 경우가 있다. 벗겨낸다. */
export function stripFence(text: string): string {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(t);
  if (fenced?.[1] !== undefined) return fenced[1].trim();

  // 앞뒤에 잡소리가 붙은 경우: 가장 바깥 중괄호 범위만 잘라낸다.
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end > start) return t.slice(start, end + 1);

  return t;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
}

function spawnCollect(
  cmd: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new ClaudeCliError(`claude -p 가 ${timeoutMs}ms 안에 끝나지 않았습니다.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (stdout += c));
    child.stderr.on("data", (c: string) => (stderr += c));

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (err.code === "ENOENT" || err.code === "EINVAL") {
        reject(
          new ClaudeCliError(
            `Claude Code CLI(${cmd})를 실행할 수 없습니다(${err.code}). 설치 여부를 확인하거나 CLAUDE_BIN에 claude.exe 경로를 직접 지정하세요.`,
          ),
        );
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(
          new ClaudeCliError(
            `claude -p 가 종료코드 ${code}로 끝났습니다.`,
            (stderr || stdout).slice(0, 2000),
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin.end(stdin, "utf8");
  });
}
