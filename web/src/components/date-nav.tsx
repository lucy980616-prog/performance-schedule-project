"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function DateNav({ date, basePath = "/" }: { date: string; basePath?: string }) {
  const router = useRouter();
  const d = new Date(`${date}T00:00:00`);
  const go = (next: string) => router.push(`${basePath}?date=${next}`);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex items-center justify-between gap-2">
      <Button variant="ghost" size="icon" onClick={() => go(shift(date, -1))} aria-label="이전 날짜">
        <ChevronLeft className="size-5" />
      </Button>

      <div className="flex flex-col items-center">
        <label className="cursor-pointer text-lg font-semibold">
          {d.getFullYear()}년 {d.getMonth() + 1}월 {d.getDate()}일 ({WEEKDAYS[d.getDay()]})
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && go(e.target.value)}
            className="sr-only"
          />
        </label>
        {date !== today && (
          <button
            onClick={() => go(today)}
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            오늘로
          </button>
        )}
      </div>

      <Button variant="ghost" size="icon" onClick={() => go(shift(date, 1))} aria-label="다음 날짜">
        <ChevronRight className="size-5" />
      </Button>
    </div>
  );
}
