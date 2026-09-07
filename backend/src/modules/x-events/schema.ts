import { z } from "zod";

// 게시물 원본 타입은 shared/etl.ts 의 ExtractedBundle 로 통일했다.
// 예매처(②)와 X(③)가 같은 구조를 쓰기 위해서다.

/** 게시물에서 뽑아낸 구조화 결과. 커튼콜·팬사인·프레스콜·할인·캐스팅변경 등. */
export const EventExtraction = z.object({
  events: z
    .array(
      z.object({
        kind: z
          .string()
          .describe("이벤트 종류: 커튼콜 / 팬사인 / 프레스콜 / 할인 / 캐스팅변경 / 공지 / 기타"),
        title: z.string().describe("한 줄 제목"),
        showName: z.string().nullable().describe("관련 공연명. 모르면 null"),
        date: z.string().nullable().describe("이벤트 날짜 YYYY-MM-DD. 모르면 null"),
        time: z.string().nullable().describe("시간 HH:MM. 모르면 null"),
        description: z.string().describe("본문 요약"),
        confidence: z.number().min(0).max(1).describe("추출 확신도 0~1"),
      }),
    )
    .describe("게시물에서 찾은 이벤트. 이벤트성 내용이 없으면 빈 배열"),
  warnings: z.array(z.string()).describe("애매하거나 추측한 부분. 없으면 빈 배열"),
});

export type EventExtraction = z.infer<typeof EventExtraction>;
