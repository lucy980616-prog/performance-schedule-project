import Link from "next/link";
import { listShowRows } from "@/lib/queries";
import { SyncButton } from "@/components/sync-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const STATE_ORDER = ["공연중", "공연예정", "공연완료"];

export default async function ShowsPage({ searchParams }: PageProps<"/shows">) {
  const sp = await searchParams;
  const state = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const genre = Array.isArray(sp.genre) ? sp.genre[0] : sp.genre;

  const shows = listShowRows({ state, genre });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">전체 공연</h1>
        <SyncButton />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip label="전체" href="/shows" active={!state && !genre} />
        {STATE_ORDER.map((s) => (
          <FilterChip
            key={s}
            label={s}
            href={`/shows?state=${encodeURIComponent(s)}`}
            active={state === s}
          />
        ))}
        {["연극", "뮤지컬"].map((g) => (
          <FilterChip
            key={g}
            label={g}
            href={`/shows?genre=${encodeURIComponent(g)}`}
            active={genre === g}
          />
        ))}
      </div>

      {shows.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground space-y-1 py-10 text-center text-sm">
            <p>아직 불러온 공연이 없습니다.</p>
            <p>&ldquo;KOPIS 동기화&rdquo;를 눌러 공연 목록을 가져오세요.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">{shows.length}개의 공연</p>
          <ul className="space-y-2">
            {shows.map((s) => (
              <li key={s.id}>
                <Link href={`/shows/${s.id}`}>
                  <Card className="hover:bg-accent/50 transition-colors">
                    <CardContent className="flex gap-3 py-3">
                      {s.poster ? (
                        // KOPIS 포스터는 외부 호스트라 next/image 설정 없이 img로 둔다.
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
                          {s.tracked === 1 && (
                            <Badge variant="default" className="shrink-0 text-[10px]">
                              추적중
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground truncate text-xs">{s.facility}</p>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {s.start_date} ~ {s.end_date}
                        </p>
                        <div className="flex gap-1 pt-0.5">
                          {s.genre && (
                            <Badge variant="outline" className="text-[10px]">
                              {s.genre}
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

function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link href={href}>
      <Badge variant={active ? "default" : "outline"} className="cursor-pointer">
        {label}
      </Badge>
    </Link>
  );
}
