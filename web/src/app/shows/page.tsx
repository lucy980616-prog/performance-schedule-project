"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchAllShows, type ShowRow } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const STATE_ORDER = ["공연중", "공연예정", "공연완료"] as const;
const GENRES = [
  { value: "play", label: "연극" },
  { value: "musical", label: "뮤지컬" },
] as const;

export default function ShowsPage() {
  const [shows, setShows] = useState<ShowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);

  useEffect(() => {
    fetchAllShows()
      .then(setShows)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      shows.filter((s) => (state ? s.state === state : true) && (genre ? s.genre === genre : true)),
    [shows, state, genre],
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">전체 공연</h1>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          label="전체"
          active={!state && !genre}
          onClick={() => {
            setState(null);
            setGenre(null);
          }}
        />
        {STATE_ORDER.map((s) => (
          <FilterChip
            key={s}
            label={s}
            active={state === s}
            onClick={() => setState(state === s ? null : s)}
          />
        ))}
        {GENRES.map((g) => (
          <FilterChip
            key={g.value}
            label={g.label}
            active={genre === g.value}
            onClick={() => setGenre(genre === g.value ? null : g.value)}
          />
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground py-10 text-center text-sm">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground space-y-1 py-10 text-center text-sm">
            <p>해당하는 공연이 없습니다.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">{filtered.length}개의 공연</p>
          <ul className="space-y-2">
            {filtered.map((s) => (
              <li key={s.id}>
                <Link href={`/shows/${s.id}`}>
                  <Card className="hover:bg-accent/50 transition-colors">
                    <CardContent className="flex gap-3 py-3">
                      {s.poster ? (
                        // 예매처 포스터는 외부 호스트라 next/image 설정 없이 img로 둔다.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.poster}
                          alt=""
                          className="bg-muted h-24 w-16 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="bg-muted h-24 w-16 shrink-0 rounded" />
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start gap-2">
                          <p className="min-w-0 flex-1 font-medium">{s.name}</p>
                          {s.tracked && (
                            <Badge variant="default" className="shrink-0 text-[10px]">
                              추적중
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground truncate text-xs">{s.venue}</p>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {s.start_date ?? "?"} ~ {s.end_date ?? "?"}
                        </p>
                        <div className="flex gap-1 pt-0.5">
                          {s.genre && (
                            <Badge variant="outline" className="text-[10px]">
                              {s.genre === "musical" ? "뮤지컬" : s.genre === "play" ? "연극" : s.genre}
                            </Badge>
                          )}
                          {s.state && (
                            <Badge
                              variant={s.state === "공연중" ? "default" : "secondary"}
                              className="text-[10px]"
                            >
                              {s.state}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick}>
      <Badge variant={active ? "default" : "outline"} className="cursor-pointer">
        {label}
      </Badge>
    </button>
  );
}
