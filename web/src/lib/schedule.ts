/**
 * KOPIS의 `dtguidance`(요일별 공연시간 안내)를 실제 회차 목록으로 펼친다.
 *
 * KOPIS는 "화요일 ~ 금요일(20:00), 토요일(15:00,19:00)" 같은 자연어 패턴만 주고
 * 실제 날짜별 회차는 주지 않는다. 이 함수가 달력의 뼈대를 만들어 주고,
 * 그 위에 캐스팅을 얹는 구조다.
 *
 * 휴관일이나 비정기 회차까지는 알 수 없으므로, 생성된 회차는 어디까지나
 * "예상 회차"이고 사용자가 화면에서 지우거나 추가할 수 있어야 한다.
 */

const DAY_INDEX: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

export interface GeneratedShowtime {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}

interface DayRule {
  days: number[]; // 0=일 ... 6=토
  times: string[];
}

/** "화요일 ~ 금요일(20:00), 토요일(15:00,19:00)" → 요일 규칙 목록 */
export function parseTimeGuidance(guidance: string): DayRule[] {
  if (!guidance) return [];

  const rules: DayRule[] = [];
  // "…(시간,시간)" 단위로 끊는다.
  const chunks = guidance.match(/[^()]*\([^)]*\)/g) ?? [];

  for (const chunk of chunks) {
    const m = /^(.*?)\(([^)]*)\)$/.exec(chunk.trim());
    if (!m) continue;

    const dayPart = m[1].replace(/^[,\s]+/, "").trim();
    const times = m[2]
      .split(",")
      .map((t) => t.trim())
      .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
      .map((t) => {
        const [h, min] = t.split(":");
        return `${h.padStart(2, "0")}:${min}`;
      });

    if (times.length === 0) continue;

    const days = parseDays(dayPart);
    if (days.length > 0) rules.push({ days, times });
  }

  return rules;
}

/** "화요일 ~ 금요일" → [2,3,4,5] / "토요일" → [6] */
function parseDays(part: string): number[] {
  // 범위 표기: "화요일 ~ 금요일", "월~금"
  const range = /([월화수목금토일])요?일?\s*[~-]\s*([월화수목금토일])요?일?/.exec(part);
  if (range) {
    const from = DAY_INDEX[range[1]];
    const to = DAY_INDEX[range[2]];
    const days: number[] = [];
    // 일(0)~토(6) 순환. "금~월" 같은 역방향도 감싸서 처리한다.
    for (let i = 0; i < 7; i++) {
      const d = (from + i) % 7;
      days.push(d);
      if (d === to) break;
    }
    return days;
  }

  // 나열 표기: "월요일, 수요일" / "토요일"
  const days = new Set<number>();
  for (const ch of part.matchAll(/([월화수목금토일])요일/g)) {
    days.add(DAY_INDEX[ch[1]]);
  }
  if (days.size === 0) {
    // "월,수,금" 처럼 '요일' 없이 쓰는 경우
    for (const ch of part.matchAll(/(?:^|[,\s])([월화수목금토일])(?=[,\s]|$)/g)) {
      days.add(DAY_INDEX[ch[1]]);
    }
  }
  return [...days];
}

/** 공연 기간 × 요일 규칙 → 실제 회차 목록 */
export function generateShowtimes(
  guidance: string,
  startDate: string,
  endDate: string,
  limitDays = 400,
): GeneratedShowtime[] {
  const rules = parseTimeGuidance(guidance);
  if (rules.length === 0) return [];

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const out: GeneratedShowtime[] = [];
  const seen = new Set<string>();
  const cursor = new Date(start);

  for (let i = 0; i <= limitDays && cursor <= end; i++) {
    const dow = cursor.getDay();
    const date = toISODate(cursor);

    for (const rule of rules) {
      if (!rule.days.includes(dow)) continue;
      for (const time of rule.times) {
        const key = `${date} ${time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ date, time });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}
