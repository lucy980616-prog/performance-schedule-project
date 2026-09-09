"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchByDate, fetchFavoriteActors, type TodayEntry } from "@/lib/data";
import { todayISO } from "@/lib/utils";
import { DateNav } from "@/components/date-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default function TodayPage() {
  const [date, setDate] = useState(todayISO());
  const [entries, setEntries] = useState<TodayEntry[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchByDate(date), fetchFavoriteActors()])
      .then(([e, f]) => {
        if (cancelled) return;
        setEntries(e);
        setFavorites(new Set(f));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date]);

  function handleDateChange(next: string) {
    setLoading(true);
    setDate(next);
  }

  return (
    <div className="space-y-4">
      <DateNav date={date} onChange={handleDateChange} />

      {loading ? (
        <p className="text-muted-foreground py-10 text-center text-sm">불러오는 중…</p>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground space-y-2 py-10 text-center text-sm">
            <p>이 날짜에 등록된 회차가 없습니다.</p>
            <p>
              <Link href="/shows" className="text-foreground underline">
                전체 공연
              </Link>
              에서 다른 날짜를 확인해 보세요.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.showtimeId}>
              <Card>
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/shows/${e.showId}`}
                        className="font-semibold hover:underline"
                      >
                        {e.showName}
                      </Link>
                      <p className="text-muted-foreground truncate text-xs">{e.venue}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                      {e.time}
                    </Badge>
                  </div>

                  {e.note && (
                    <p className="text-xs font-medium text-amber-600 dark:text-amber-500">
                      {e.note}
                    </p>
                  )}

                  {e.actors.length > 0 ? (
                    <p className="text-sm leading-relaxed">
                      {e.actors.map((a, i) => (
                        <span key={`${a}-${i}`}>
                          {i > 0 && <span className="text-muted-foreground">, </span>}
                          <Link
                            href={`/actors/${encodeURIComponent(a)}`}
                            className={
                              favorites.has(a)
                                ? "font-semibold text-rose-600 hover:underline dark:text-rose-400"
                                : "hover:underline"
                            }
                          >
                            {a}
                          </Link>
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">캐스팅 미등록</p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
