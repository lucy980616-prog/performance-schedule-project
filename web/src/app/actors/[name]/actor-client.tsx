"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchActorShowtimes, fetchFavoriteActors, type ActorShowtime } from "@/lib/data";
import { todayISO } from "@/lib/utils";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { Card, CardContent } from "@/components/ui/card";

export function ActorClient({ name }: { name: string }) {
  const [showtimes, setShowtimes] = useState<ActorShowtime[]>([]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchActorShowtimes(name), fetchFavoriteActors()])
      .then(([st, favs]) => {
        setShowtimes(st);
        setIsFavorite(favs.includes(name));
      })
      .finally(() => setLoading(false));
  }, [name]);

  const today = todayISO();
  const upcoming = showtimes.filter((s) => s.date >= today);
  const past = showtimes.filter((s) => s.date < today);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{name}</h1>
        <FavoriteToggle name={name} initial={isFavorite} />
      </div>

      {loading ? (
        <p className="text-muted-foreground py-10 text-center text-sm">불러오는 중…</p>
      ) : showtimes.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            등록된 회차가 없습니다.
          </CardContent>
        </Card>
      ) : (
        <>
          <Section title={`다가오는 회차 (${upcoming.length})`} items={upcoming} />
          {past.length > 0 && <Section title={`지난 회차 (${past.length})`} items={past} muted />}
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
  items: ActorShowtime[];
  muted?: boolean;
}) {
  if (items.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">예정된 회차가 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title}</h2>
      <ul className={muted ? "divide-y opacity-60" : "divide-y"}>
        {items.map((s) => (
          <li key={`${s.show_id}-${s.date}-${s.time}`} className="flex gap-3 py-2 text-sm">
            <span className="text-muted-foreground w-24 shrink-0 tabular-nums">
              {s.date.slice(5)} {s.time}
            </span>
            <span className="min-w-0 flex-1">
              <Link href={`/shows/${s.show_id}`} className="font-medium hover:underline">
                {s.show_name}
              </Link>
              <span className="text-muted-foreground block text-xs">{s.venue}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
