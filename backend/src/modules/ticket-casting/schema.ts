import { z } from "zod";

/**
 * 예매처 상세페이지의 캐스팅 캘린더(대부분 이미지 한 장)를 회차별 데이터로 옮긴 결과.
 *
 * KOPIS는 작품 전체 출연진(prfcast)만 주고 "몇 월 며칠 몇 시 회차에 누가 나오는지"는 주지 않는다.
 * 그 빈칸을 채우는 게 이 모듈이다.
 */
export const CastingExtraction = z.object({
  entries: z
    .array(
      z.object({
        date: z.string().describe("공연 날짜, YYYY-MM-DD"),
        time: z.string().describe("공연 시작 시간, HH:MM 24시간제"),
        actors: z.array(z.string()).describe("해당 회차 출연 배우 이름"),
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
    .describe("판독이 애매하거나 추측한 부분. 없으면 빈 배열"),
});

export type CastingExtraction = z.infer<typeof CastingExtraction>;

export interface ExtractContext {
  showName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  /** KOPIS prfcast — 이름 오독을 줄이는 데 쓴다 */
  knownActors?: string[];
}

/** 날짜/시간 형식이 실제로 맞는 회차만 남긴다. AI가 형식을 어겨도 DB로 새어 나가지 않게. */
export function validEntries(r: CastingExtraction) {
  return r.entries.filter(
    (e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && /^\d{2}:\d{2}$/.test(e.time),
  );
}
