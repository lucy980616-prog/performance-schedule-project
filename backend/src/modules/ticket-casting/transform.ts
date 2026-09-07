/**
 * 모듈 2-2 (Transform) — 캐스팅표(이미지/텍스트) → 회차별 캐스팅 JSON.
 *
 * 입력은 ExtractedBundle 하나뿐이다. 이 파일은 인터파크에서 왔는지 예스24에서 왔는지 모른다.
 * 새 예매처가 늘어나도 여기는 손대지 않는다 — 그게 ETL로 쪼갠 이유다.
 *
 * 이미지는 base64로 인라인하지 않는다. `claude -p`에 파일 경로를 주고 Read 툴로 읽게 한다.
 */
import fs from "node:fs";
import path from "node:path";
import { runClaudeJson } from "../../shared/claude.ts";
import { wrap, type ExtractedBundle, type TransformResult } from "../../shared/etl.ts";
import { CastingExtraction, type ExtractContext } from "./schema.ts";

/** 이 길이 미만이면 텍스트만으로는 판독이 안 된다고 보고 이미지를 쓴다. */
const TEXT_ENOUGH = 200;

function systemPrompt(ctx: ExtractContext): string {
  const lines = [
    "당신은 한국 뮤지컬/연극의 예매처 캐스팅 캘린더를 구조화된 데이터로 옮기는 작업을 합니다.",
    "",
    "규칙:",
    "- 입력에 실제로 있는 회차만 추출하세요. 없는 날짜를 추측해서 만들지 마세요.",
    "- 날짜에 연도가 없으면 공연 기간을 기준으로 연도를 판단하세요.",
    "- 시간은 24시간제 HH:MM으로 정규화하세요. (예: 오후 8시 → 20:00)",
    "- 배우 이름만 배열에 넣으세요. 배역명이 이름에 붙어 있으면 분리하세요.",
    "- 한 날짜에 여러 회차가 있으면 각각 별도 항목으로 만드세요.",
    "- 판독이 불확실한 이름이나 날짜는 warnings에 남기세요.",
    "",
    `공연명: ${ctx.showName}`,
    `공연 기간: ${ctx.startDate} ~ ${ctx.endDate}`,
  ];

  if (ctx.knownActors?.length) {
    lines.push(
      "",
      "이 작품의 알려진 출연진 명단입니다. 이름 판독에 참고하되, 여기 없는 이름이 나와도 그대로 기록하세요:",
      ctx.knownActors.join(", "),
    );
  }

  lines.push(
    "",
    "다음 JSON 스키마 그대로 출력하세요:",
    JSON.stringify(
      {
        entries: [
          { date: "YYYY-MM-DD", time: "HH:MM", actors: ["배우명"], note: "특이사항 또는 null" },
        ],
        roles: [{ role: "배역명", actors: ["배우명"] }],
        warnings: ["애매했던 부분"],
      },
      null,
      2,
    ),
  );

  return lines.join("\n");
}

export async function transformCasting(
  bundle: ExtractedBundle,
  ctx: ExtractContext,
): Promise<TransformResult<CastingExtraction>> {
  const images = bundle.imagePaths.filter((p) => fs.existsSync(p));
  const useText = bundle.text.length >= TEXT_ENOUGH && images.length === 0;

  const prompt = useText
    ? [
        "다음은 예매처 상세페이지에서 긁은 캐스팅 일정입니다. 회차별 캐스팅 JSON으로 정리해 출력하세요.",
        "",
        bundle.text,
      ].join("\n")
    : [
        "아래 이미지 파일을 Read 툴로 읽으세요. 예매처 상세페이지의 캐스팅 캘린더입니다.",
        ...images.map((p) => `- ${path.resolve(p)}`),
        "",
        ...(bundle.text
          ? ["참고 — 같은 페이지에서 긁은 텍스트입니다:", bundle.text.slice(0, 4000), ""]
          : []),
        "읽은 내용을 회차별 캐스팅 JSON으로 정리해 출력하세요.",
      ].join("\n");

  if (!useText && images.length === 0) {
    throw new Error(
      `${bundle.url}: 판독할 이미지도 텍스트도 없습니다. 2-1 수집이 실패한 것입니다.`,
    );
  }

  const data = await runClaudeJson({
    system: systemPrompt(ctx),
    prompt,
    allowRead: !useText,
    schema: CastingExtraction,
  });

  return wrap(bundle, data, data.warnings);
}

/** 스크래핑 없이 텍스트만으로 판독한다. 프롬프트를 고칠 때 빠르게 돌려보는 용도. */
export async function transformText(
  text: string,
  ctx: ExtractContext,
): Promise<CastingExtraction> {
  return runClaudeJson({
    system: systemPrompt(ctx),
    prompt: [
      "다음은 예매처에서 복사한 캐스팅 일정입니다. 회차별 캐스팅 JSON으로 정리해 출력하세요.",
      "",
      text,
    ].join("\n"),
    schema: CastingExtraction,
  });
}

/** 캡처 이미지 파일들로 바로 판독한다. fixtures 로 반복 테스트할 때 쓴다. */
export async function transformImages(
  paths: string[],
  ctx: ExtractContext,
): Promise<CastingExtraction> {
  for (const p of paths) {
    if (!fs.existsSync(p)) throw new Error(`캐스팅표 이미지가 없습니다: ${p}`);
  }
  return runClaudeJson({
    system: systemPrompt(ctx),
    prompt: [
      "아래 이미지 파일을 Read 툴로 읽으세요. 예매처의 캐스팅 캘린더 캡처입니다.",
      ...paths.map((p) => `- ${path.resolve(p)}`),
      "",
      "읽은 내용을 회차별 캐스팅 JSON으로 정리해 출력하세요.",
    ].join("\n"),
    allowRead: true,
    schema: CastingExtraction,
  });
}
