"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CalendarShowtime {
  id: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  note: string | null;
  actors: string[];
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function CastingCalendar({
  showtimes,
  favorites = [],
  initialMonth,
}: {
  showtimes: CalendarShowtime[];
  favorites?: string[];
  initialMonth?: string; // YYYY-MM
}) {
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  // 공연 기간 안에서 시작 월을 정한다: 오늘이 포함되면 이번 달, 아니면 첫 회차의 달.
  const defaultMonth = useMemo(() => {
    if (initialMonth) return initialMonth;
    const today = monthKey(new Date());
    const months = new Set(showtimes.map((s) => s.date.slice(0, 7)));
    return months.has(today) ? today : (showtimes[0]?.date.slice(0, 7) ?? today);
  }, [initialMonth, showtimes]);

  const [month, setMonth] = useState(defaultMonth);
  const [view, setView] = useState<"calendar" | "list">("calendar");

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarShowtime[]>();
    for (const s of showtimes) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return map;
  }, [showtimes]);

  const [year, mon] = month.split("-").map(Number);
  const first = new Date(year, mon - 1, 1);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const leading = first.getDay();

  const cells: (string | null)[] = [
    ...Array<null>(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      return `${year}-${String(mon).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, mon - 1 + delta, 1);
    setMonth(monthKey(d));
  };

  const today = new Date().toISOString().slice(0, 10);

  const monthEntries = showtimes
    .filter((s) => s.date.startsWith(month))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const renderActors = (actors: string[]) =>
    actors.map((a, i) => (
      <span key={`${a}-${i}`}>
        {i > 0 && ", "}
        <span className={favoriteSet.has(a) ? "font-bold text-rose-600 dark:text-rose-400" : ""}>
          {a}
        </span>
      </span>
    ));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)} aria-label="이전 달">
            <ChevronLeft className="size-5" />
          </Button>
          <h3 className="min-w-28 text-center font-semibold">
            {year}년 {mon}월
          </h3>
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(1)} aria-label="다음 달">
            <ChevronRight className="size-5" />
          </Button>
        </div>

        <div className="flex gap-1">
          {(["calendar", "list"] as const).map((v) => (
            <Button
              key={v}
              variant={view === v ? "default" : "outline"}
              size="sm"
              onClick={() => setView(v)}
            >
              {v === "calendar" ? "달력" : "목록"}
            </Button>
          ))}
        </div>
      </div>

      {view === "calendar" ? (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="text-muted-foreground grid grid-cols-7 border-b text-center text-xs font-medium">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  className={cn("py-1.5", i === 0 && "text-red-500", i === 6 && "text-blue-500")}
                >
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {cells.map((date, i) => {
                const items = date ? (byDate.get(date) ?? []) : [];
                return (
                  <div
                    key={date ?? `empty-${i}`}
                    className={cn(
                      "min-h-24 border-r border-b p-1 text-[11px]",
                      i % 7 === 0 && "border-l",
                      date === today && "bg-accent",
                      !date && "bg-muted/30",
                    )}
                  >
                    {date && (
                      <>
                        <div
                          className={cn(
                            "mb-0.5 font-medium tabular-nums",
                            i % 7 === 0 && "text-red-500",
                            i % 7 === 6 && "text-blue-500",
                          )}
                        >
                          {Number(date.slice(8))}
                        </div>
                        <div className="space-y-1">
                          {items.map((s) => (
                            <div key={s.id} className="leading-tight">
                              <span className="text-muted-foreground tabular-nums">{s.time}</span>
                              {s.note && <span className="ml-0.5 text-amber-600">❗</span>}
                              {s.actors.length > 0 && (
                                <div className="break-words">{renderActors(s.actors)}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : monthEntries.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          이 달에는 등록된 회차가 없습니다.
        </p>
      ) : (
        <ul className="divide-y">
          {monthEntries.map((s) => (
            <li key={s.id} className="flex gap-3 py-2 text-sm">
              <span className="text-muted-foreground w-24 shrink-0 tabular-nums">
                {s.date.slice(5)} {s.time}
              </span>
              <span className="min-w-0 flex-1">
                {s.actors.length > 0 ? (
                  renderActors(s.actors)
                ) : (
                  <span className="text-muted-foreground">캐스팅 미등록</span>
                )}
                {s.note && <span className="block text-xs text-amber-600">{s.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
