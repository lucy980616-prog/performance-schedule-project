"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchMySchedule, type MyScheduleItem } from "@/lib/data";
import { todayISO } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export default function MyCalendarPage() {
  const [items, setItems] = useState<MyScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMySchedule()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  const today = todayISO();
  const upcoming = items.filter((i) => i.date >= today);
  const past = items.filter((i) => i.date < today);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">내 달력</h1>

      {loading ? (
        <p className="text-muted-foreground py-10 text-center text-sm">불러오는 중…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground space-y-1 py-10 text-center text-sm">
            <p>등록한 관람 일정이 없습니다.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Section title={`예정 (${upcoming.length})`} items={upcoming} />
          {past.length > 0 && <Section title={`관람 완료 (${past.length})`} items={past} muted />}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  muted = false,
}: {
  title: string;
  items: MyScheduleItem[];
  muted?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title}</h2>
      <ul className={muted ? "space-y-2 opacity-60" : "space-y-2"}>
        {items.map((i) => (
          <li key={i.id}>
            <Card>
              <CardContent className="flex gap-3 py-3 text-sm">
                <span className="text-muted-foreground w-24 shrink-0 tabular-nums">
                  {i.date.slice(5)} {i.time}
                </span>
                <span className="min-w-0 flex-1">
                  <Link href={`/shows/${i.show_id}`} className="font-medium hover:underline">
                    {i.show_name}
                  </Link>
                  <span className="text-muted-foreground block text-xs">{i.venue}</span>
                  {i.seat && <span className="block text-xs">좌석 {i.seat}</span>}
                  {i.memo && <span className="text-muted-foreground block text-xs">{i.memo}</span>}
                </span>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
