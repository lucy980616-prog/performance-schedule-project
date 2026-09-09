"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchFavoriteActors,
  fetchRoles,
  fetchShow,
  fetchShowtimesWithCast,
  type ShowRow,
  type ShowtimeWithCast,
} from "@/lib/data";
import { splitNames } from "@/lib/utils";
import { CastingCalendar } from "@/components/casting-calendar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const GENRE_LABEL: Record<string, string> = { musical: "뮤지컬", play: "연극" };

export function ShowDetailClient({ id }: { id: number }) {
  const [show, setShow] = useState<ShowRow | null | undefined>(undefined);
  const [showtimes, setShowtimes] = useState<ShowtimeWithCast[]>([]);
  const [roles, setRoles] = useState<{ role: string; actor: string; ord: number }[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([fetchShow(id), fetchShowtimesWithCast(id), fetchRoles(id), fetchFavoriteActors()]).then(
      ([s, st, r, f]) => {
        setShow(s);
        setShowtimes(st);
        setRoles(r);
        setFavorites(f);
      },
    );
  }, [id]);

  if (show === undefined) {
    return <p className="text-muted-foreground py-10 text-center text-sm">불러오는 중…</p>;
  }
  if (show === null) {
    return <p className="text-muted-foreground py-10 text-center text-sm">공연을 찾을 수 없습니다.</p>;
  }

  const roleGroups = roles.reduce<{ role: string; actors: string[] }[]>((acc, r) => {
    const last = acc.find((g) => g.role === r.role);
    if (last) last.actors.push(r.actor);
    else acc.push({ role: r.role, actors: [r.actor] });
    return acc;
  }, []);

  const castCount = showtimes.filter((s) => s.actors.length > 0).length;

  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        {show.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={show.poster}
            alt=""
            className="bg-muted h-40 w-28 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="bg-muted h-40 w-28 shrink-0 rounded" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {show.genre && <Badge variant="outline">{GENRE_LABEL[show.genre] ?? show.genre}</Badge>}
            {show.state && (
              <Badge variant={show.state === "공연중" ? "default" : "secondary"}>{show.state}</Badge>
            )}
          </div>
          <h1 className="text-lg leading-snug font-bold">{show.name}</h1>
          <p className="text-muted-foreground text-sm tabular-nums">
            {show.start_date ?? "?"} ~ {show.end_date ?? "?"}
          </p>
          <p className="text-muted-foreground text-sm">{show.venue}</p>
          {show.address && <p className="text-muted-foreground text-xs">{show.address}</p>}
          {show.url && (
            <a
              href={show.url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground text-xs underline"
            >
              예매처에서 보기
            </a>
          )}
        </div>
      </div>

      {show.price != null && (
        <section className="space-y-1.5">
          <h2 className="font-semibold">가격</h2>
          <p className="text-sm">{show.price.toLocaleString()}원</p>
        </section>
      )}

      <Separator />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">회차별 캐스팅</h2>
            <p className="text-muted-foreground text-xs">
              전체 {showtimes.length}회차 중 {castCount}회차 캐스팅 등록됨
            </p>
          </div>
        </div>

        {showtimes.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground space-y-1 py-8 text-center text-sm">
              <p>아직 회차가 없습니다.</p>
            </CardContent>
          </Card>
        ) : (
          <CastingCalendar showtimes={showtimes} favorites={favorites} />
        )}
      </section>

      {roleGroups.length > 0 && (
        <>
          <Separator />
          <section className="space-y-2">
            <h2 className="font-semibold">배역</h2>
            <ul className="space-y-1.5 text-sm">
              {roleGroups.map((g) => (
                <li key={g.role} className="flex gap-3">
                  <span className="text-muted-foreground w-20 shrink-0">{g.role}</span>
                  <span className="min-w-0 flex-1">
                    {g.actors.map((a, i) => (
                      <span key={a}>
                        {i > 0 && ", "}
                        <Link
                          href={`/actors/${encodeURIComponent(a)}`}
                          className="hover:underline"
                        >
                          {a}
                        </Link>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {show.cast_raw && (
        <>
          <Separator />
          <section className="space-y-2">
            <h2 className="font-semibold">
              전체 출연진
              <span className="text-muted-foreground ml-1.5 text-xs font-normal">예매처 제공</span>
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {splitNames(show.cast_raw).map((a) => (
                <Link key={a} href={`/actors/${encodeURIComponent(a)}`}>
                  <Badge variant="secondary" className="cursor-pointer">
                    {a}
                  </Badge>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}

      {show.organizer && (
        <section className="space-y-1.5">
          <h2 className="font-semibold">제작사</h2>
          <p className="text-muted-foreground text-sm">{show.organizer}</p>
        </section>
      )}
    </div>
  );
}
