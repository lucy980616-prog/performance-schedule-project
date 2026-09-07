import Link from "next/link";
import { listFavoriteActors, listFavoriteActorShowtimes } from "@/lib/queries";
import { todayISO } from "@/lib/schedule";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function FavoriteActorsPage() {
  const actors = listFavoriteActors();
  const showtimes = listFavoriteActorShowtimes(todayISO());

  // 날짜별로 묶어서 달력처럼 훑어보게 한다
  const byDate = showtimes.reduce<Map<string, typeof showtimes>>((map, s) => {
    const list = map.get(s.date) ?? [];
    list.push(s);
    map.set(s.date, list);
    return map;
  }, new Map());

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">애배 달력</h1>

      {actors.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground space-y-1 py-10 text-center text-sm">
            <p>등록한 애배가 없습니다.</p>
            <p>공연 상세나 오늘의 공연에서 배우 이름을 눌러 등록하세요.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {actors.map((a) => (
              <Link key={a} href={`/actors/${encodeURIComponent(a)}`}>
                <Badge className="cursor-pointer bg-rose-600 hover:bg-rose-700">{a}</Badge>
              </Link>
            ))}
          </div>

          {byDate.size === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-10 text-center text-sm">
                앞으로 예정된 애배 회차가 없습니다.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3">
              {[...byDate.entries()].map(([date, items]) => (
                <li key={date}>
                  <Card>
                    <CardContent className="space-y-2 py-3">
                      <p className="text-sm font-semibold tabular-nums">{date}</p>
                      <ul className="space-y-1.5">
                        {items.map((s) => (
                          <li
                            key={`${s.actor}-${s.show_id}-${s.time}`}
                            className="flex gap-2 text-sm"
                          >
                            <span className="text-muted-foreground w-12 shrink-0 tabular-nums">
                              {s.time}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="font-medium text-rose-600 dark:text-rose-400">
                                {s.actor}
                              </span>
                              <span className="text-muted-foreground"> · </span>
                              <Link href={`/shows/${s.show_id}`} className="hover:underline">
                                {s.show_name}
                              </Link>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
