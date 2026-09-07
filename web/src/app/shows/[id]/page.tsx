import Link from "next/link";
import { notFound } from "next/navigation";
import { splitNames } from "@/lib/kopis";
import {
  getShowRow,
  listFavoriteActors,
  listRoles,
  listShowtimesWithCast,
} from "@/lib/queries";
import { CastingCalendar } from "@/components/casting-calendar";
import { ExtractDialog } from "@/components/extract-dialog";
import { ShowSyncButton } from "@/components/show-sync-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

export default async function ShowDetailPage({ params }: PageProps<"/shows/[id]">) {
  const { id } = await params;
  const show = getShowRow(id);
  if (!show) notFound();

  const showtimes = listShowtimesWithCast(id);
  const roles = listRoles(id);
  const favorites = listFavoriteActors();

  // 배역별로 배우를 묶는다 (roles 테이블은 (배역, 배우) 평면 구조)
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
            {show.genre && <Badge variant="outline">{show.genre}</Badge>}
            {show.state && (
              <Badge variant={show.state === "공연중" ? "default" : "secondary"}>
                {show.state}
              </Badge>
            )}
            {show.area && <Badge variant="outline">{show.area}</Badge>}
          </div>
          <h1 className="text-lg leading-snug font-bold">{show.name}</h1>
          <p className="text-muted-foreground text-sm tabular-nums">
            {show.start_date} ~ {show.end_date}
          </p>
          <p className="text-muted-foreground text-sm">{show.facility}</p>
          {show.runtime && <p className="text-muted-foreground text-xs">{show.runtime}</p>}
          {show.age && <p className="text-muted-foreground text-xs">{show.age}</p>}
        </div>
      </div>

      <ShowSyncButton showId={id} tracked={show.tracked === 1} />

      {show.detail_synced === 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
          <CardContent className="py-3 text-sm">
            아직 상세 정보를 불러오지 않았습니다. &ldquo;KOPIS 상세 불러오기&rdquo;를 누르면
            출연진·가격·공연시간을 가져오고 회차 달력을 만듭니다.
          </CardContent>
        </Card>
      )}

      {show.price && (
        <section className="space-y-1.5">
          <h2 className="font-semibold">가격</h2>
          <p className="text-sm whitespace-pre-line">{show.price}</p>
        </section>
      )}

      {show.time_guidance && (
        <section className="space-y-1.5">
          <h2 className="font-semibold">공연 시간</h2>
          <p className="text-sm whitespace-pre-line">{show.time_guidance}</p>
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
          <ExtractDialog showId={id} />
        </div>

        {showtimes.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground space-y-1 py-8 text-center text-sm">
              <p>아직 회차가 없습니다.</p>
              <p>&ldquo;KOPIS 상세 불러오기&rdquo;로 회차 달력을 먼저 만들어 주세요.</p>
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
              <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                KOPIS 제공
              </span>
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

      {show.crew_raw && (
        <section className="space-y-1.5">
          <h2 className="font-semibold">제작진</h2>
          <p className="text-muted-foreground text-sm">{show.crew_raw}</p>
        </section>
      )}

      {show.company && (
        <section className="space-y-1.5">
          <h2 className="font-semibold">제작사</h2>
          <p className="text-muted-foreground text-sm">{show.company}</p>
        </section>
      )}

      <p className="text-muted-foreground pt-4 text-center text-[11px]">
        공연 정보 출처: (재)예술경영지원센터 공연예술통합전산망(www.kopis.or.kr)
      </p>
    </div>
  );
}
