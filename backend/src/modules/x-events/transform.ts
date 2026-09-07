/**
 * 모듈 3-2 (Transform) — 게시물 본문 + 첨부 이미지 → 이벤트 JSON.
 *
 * 입력은 ExtractedBundle 하나뿐이다. 이 파일은 게시물이 신디케이션에서 왔는지
 * Playwright에서 왔는지 모른다 — 그게 ETL로 쪼갠 이유다.
 *
 * 공연계 계정은 정보를 대부분 **이미지 한 장**에 넣어서 올린다. 본문만 봐서는 아무것도 못 건진다.
 */
import path from "node:path";
import { runClaudeJson } from "../../shared/claude.ts";
import { wrap, type ExtractedBundle, type TransformResult } from "../../shared/etl.ts";
import { EventExtraction } from "./schema.ts";

const SYSTEM = [
  "당신은 한국 뮤지컬/연극 관련 SNS 게시물에서 관객에게 쓸모 있는 이벤트 정보를 뽑아냅니다.",
  "",
  "규칙:",
  "- 게시물에 실제로 적힌 것만 추출하세요. 없는 날짜나 공연명을 지어내지 마세요.",
  "- 날짜에 연도가 없으면 게시 시각을 기준으로 판단하고, 애매하면 warnings에 남기세요.",
  "- 시간은 24시간제 HH:MM으로 정규화하세요.",
  "- 단순 홍보/리트윗/감사 인사처럼 관객이 챙길 일정이 없으면 events를 빈 배열로 두세요.",
  "- 판독이 불확실하면 confidence를 낮게 주고 warnings에 이유를 남기세요.",
  "",
  "다음 JSON 스키마 그대로 출력하세요:",
  JSON.stringify(
    {
      events: [
        {
          kind: "커튼콜|팬사인|프레스콜|할인|캐스팅변경|공지|기타",
          title: "한 줄 제목",
          showName: "공연명 또는 null",
          date: "YYYY-MM-DD 또는 null",
          time: "HH:MM 또는 null",
          description: "본문 요약",
          confidence: 0.9,
        },
      ],
      warnings: ["애매했던 부분"],
    },
    null,
    2,
  ),
].join("\n");

export async function transformPost(
  bundle: ExtractedBundle,
): Promise<TransformResult<EventExtraction>> {
  const lines = [
    `계정: @${bundle.meta.handle ?? "?"}`,
    `게시 시각: ${bundle.postedAt ?? "알 수 없음"}`,
    `URL: ${bundle.url}`,
    "",
    "본문:",
    bundle.text || "(본문 없음 — 이미지만 있는 게시물)",
  ];

  if (bundle.imagePaths.length > 0) {
    lines.push(
      "",
      "첨부 이미지입니다. Read 툴로 읽고 안에 적힌 내용까지 반영하세요:",
      ...bundle.imagePaths.map((p) => `- ${path.resolve(p)}`),
    );
  }

  lines.push("", "이 게시물에서 이벤트 정보를 뽑아 JSON으로 출력하세요.");

  const data = await runClaudeJson({
    system: SYSTEM,
    prompt: lines.join("\n"),
    allowRead: bundle.imagePaths.length > 0,
    schema: EventExtraction,
  });

  return wrap(bundle, data, data.warnings);
}

/** 여러 건을 순차 처리한다. 동시에 여러 CLI를 띄우지 않는다. */
export async function transformPosts(
  bundles: ExtractedBundle[],
): Promise<TransformResult<EventExtraction>[]> {
  const out: TransformResult<EventExtraction>[] = [];
  for (const b of bundles) out.push(await transformPost(b));
  return out;
}
