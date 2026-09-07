import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * 예매처 캐스팅 캘린더(텍스트 또는 캡처 이미지)를 회차별 캐스팅 데이터로 변환한다.
 *
 * KOPIS 오픈API는 작품 전체 출연진(prfcast)만 주고 "몇 월 며칠 몇 시 회차에 누가 나오는지"는
 * 주지 않는다. 그 빈칸을 채우는 게 이 모듈의 역할이다.
 */

export const CastingExtraction = z.object({
  entries: z
    .array(
      z.object({
        date: z.string().describe("공연 날짜, YYYY-MM-DD 형식"),
        time: z.string().describe("공연 시작 시간, HH:MM 24시간 형식"),
        actors: z.array(z.string()).describe("해당 회차에 출연하는 배우 이름 목록"),
        note: z
          .string()
          .nullable()
          .describe("그 회차의 특이사항(커튼콜, 대역, 프레스콜 등). 없으면 null"),
      }),
    )
    .describe("회차별 캐스팅 목록"),
  roles: z
    .array(
      z.object({
        role: z.string().describe("배역 이름"),
        actors: z.array(z.string()).describe("그 배역을 맡는 배우 목록"),
      }),
    )
    .describe("배역별 배우 목록. 입력에서 배역 구분을 알 수 없으면 빈 배열"),
  warnings: z
    .array(z.string())
    .describe("애매하거나 추측한 부분에 대한 경고. 없으면 빈 배열"),
});

export type CastingExtraction = z.infer<typeof CastingExtraction>;

export interface ExtractContext {
  showName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  knownActors?: string[]; // KOPIS prfcast — 이름 오독을 줄이는 데 쓴다
}

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

  return lines.join("\n");
}

const MEDIA_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

export function isSupportedImage(mime: string): mime is MediaType {
  return (MEDIA_TYPES as readonly string[]).includes(mime);
}

export async function extractCasting(
  input: { text: string } | { imageBase64: string; mediaType: MediaType },
  ctx: ExtractContext,
): Promise<CastingExtraction> {
  const client = new Anthropic();

  const content: Anthropic.ContentBlockParam[] =
    "text" in input
      ? [
          {
            type: "text",
            text: `다음은 예매처에서 복사한 캐스팅 일정입니다. 회차별 캐스팅으로 정리해 주세요.\n\n${input.text}`,
          },
        ]
      : [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mediaType,
              data: input.imageBase64,
            },
          },
          {
            type: "text",
            text: "이 캐스팅 캘린더 이미지를 회차별 캐스팅으로 정리해 주세요.",
          },
        ];

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: systemPrompt(ctx),
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(CastingExtraction) },
  });

  if (!response.parsed_output) {
    throw new Error("캐스팅 추출에 실패했습니다. 입력이 캐스팅 일정표가 맞는지 확인해 주세요.");
  }

  return response.parsed_output;
}
