/**
 * 수집기 진입점.  npm run collect -- --job=discover|casting|x
 *
 * KOPIS 신규 발급이 막혀 있는 동안(→ README, docs §9) NOL 장르 목록이 발견(discovery)을 대신한다.
 * Windows 작업 스케줄러에 job별로 하나씩 등록한다. 어떤 job도 실패를 삼키지 않는다 —
 * 개별 공연/계정 단위 실패는 로그를 남기고 다음으로 넘어가되, 배치 전체가 죽어야 할 오류는 던진다.
 */
import * as log from "./shared/log.ts";
import { nol, yes24, ticketlink, upsertShow, saveCasting, listShows, type ShowRow } from "./modules/ticket-casting/index.ts";
import { transformCasting } from "./modules/ticket-casting/transform.ts";
import type { ExtractContext } from "./modules/ticket-casting/schema.ts";
import {
  collectAccount,
  transformPosts,
  upsertAccount,
  listEnabledAccounts,
  updateLastSeen,
  saveEvents,
  discardImages,
} from "./modules/x-events/index.ts";

type Job = "discover" | "casting" | "x";

function parseJob(argv: string[]): Job {
  const raw = argv.find((a) => a.startsWith("--job="))?.slice("--job=".length);
  if (raw === "discover" || raw === "casting" || raw === "x") return raw;
  throw new Error("사용법: npm run collect -- --job=discover|casting|x");
}

/**
 * yes24는 자체 장르 목록 URL을 아직 못 찾았다(§9). NOL이 발견을 전담하는 동안
 * yes24/티켓링크는 여기 적어둔 알려진 공연만 상세·캐스팅을 갱신한다.
 * 새 공연은 사용자가 상세페이지 링크를 주면 여기 추가한다.
 */
const YES24_SEED_IDS = ["59596"]; // 곤 투모로우
const TICKETLINK_SEED_IDS = ["65490", "65165"]; // 죽음에 관하여 / 렛미플라이

/** 추적할 X 계정. 제작사 계정이 예매처가 못 주는 회차별 캐스팅·이벤트를 메운다 (docs §2 ③). */
const SNS_SEED: { handle: string; label: string }[] = [
  { handle: "nangman_b20", label: "낭만바리케이트 — 죽음에 관하여" },
  { handle: "letmefly_m", label: "렛미플라이" },
];

async function main() {
  const job = parseJob(process.argv.slice(2));
  log.info("cli", `job=${job} 시작`);

  switch (job) {
    case "discover":
      await runDiscover();
      break;
    case "casting":
      await runCasting();
      break;
    case "x":
      await runX();
      break;
  }

  log.info("cli", `job=${job} 완료`);
}

/** NOL 장르 목록(연극/뮤지컬)에서 공연을 찾아 shows 테이블에 등록한다. 콘서트 등은 URL 자체가 갈려 자동 제외된다. */
async function runDiscover() {
  let discovered = 0;
  for (const genre of ["musical", "play"] as const) {
    let items;
    try {
      items = await nol.fetchGenreListing(genre);
    } catch (err) {
      log.fail("cli", `NOL ${genre} 목록 조회 실패`, err instanceof Error ? err.message : err);
      continue;
    }

    for (const item of items) {
      upsertShow({
        source: "nol",
        sourceId: item.goodsKey,
        name: item.title,
        genre,
        venue: item.venue || null,
        url: item.url,
      });
      discovered++;
    }
  }

  // 예스24/티켓링크는 자동 발견이 없으므로 알고 있는 공연만 등록해 둔다.
  for (const idPerf of YES24_SEED_IDS) {
    try {
      const show = await yes24.fetchShow(idPerf);
      upsertShow({
        source: "yes24",
        sourceId: idPerf,
        name: show.name,
        startDate: show.startDate,
        endDate: show.endDate,
        venue: show.venue,
        address: show.address,
        price: show.price,
        organizer: show.organizer,
        castRaw: show.cast.join(", "),
        poster: show.poster,
        url: show.url,
      });
      discovered++;
    } catch (err) {
      log.fail("cli", `예스24 ${idPerf} 조회 실패`, err instanceof Error ? err.message : err);
    }
  }

  for (const productId of TICKETLINK_SEED_IDS) {
    try {
      const show = await ticketlink.fetchProduct(productId);
      upsertShow({
        source: "ticketlink",
        sourceId: productId,
        name: show.name,
        startDate: show.startDate,
        endDate: show.endDate,
        venue: show.venue,
        address: show.address,
        price: show.price,
        organizer: show.organizer,
        castRaw: show.castRaw,
        poster: show.poster,
        url: show.url,
      });
      discovered++;
    } catch (err) {
      log.fail("cli", `티켓링크 ${productId} 조회 실패`, err instanceof Error ? err.message : err);
    }
  }

  log.info("cli", `발견 완료 — 공연 ${discovered}건 등록/갱신`);
}

/** shows 테이블의 공연별로 회차별 캐스팅을 채운다. NOL은 구조화 API, 예스24는 이미지+claude -p. */
async function runCasting() {
  const shows: ShowRow[] = listShows();

  for (const show of shows) {
    try {
      if (show.source === "nol") {
        await syncNolCasting(show);
      } else if (show.source === "yes24") {
        await syncYes24Casting(show);
      }
      // ticketlink는 회차별 캐스팅을 얻을 방법이 없다 (README §티켓링크 참고) — 건너뛴다.
    } catch (err) {
      log.fail("cli", `show#${show.id}(${show.source}:${show.source_id}) 캐스팅 갱신 실패`, err instanceof Error ? err.message : err);
    }
  }
}

async function syncNolCasting(show: ShowRow) {
  const entries = await nol.fetchAllCasting(show.source_id);
  const extraction = nol.toCastingExtraction(entries);
  saveCasting(show.id, extraction, "nol-api");
}

async function syncYes24Casting(show: ShowRow) {
  const imagePaths = await yes24.downloadCastingImages(show.source_id).catch((err) => {
    // 캐스팅표가 없는 공연(원캐스트 등)일 수 있다 — 배치를 죽이지 않고 건너뛴다.
    log.warn("cli", `예스24 ${show.source_id}: 캐스팅표 없음`, err instanceof Error ? err.message : err);
    return [] as string[];
  });
  if (imagePaths.length === 0) return;

  const knownActors = (show.cast_raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ctx: ExtractContext = {
    showName: show.name,
    startDate: show.start_date ?? "",
    endDate: show.end_date ?? "",
    knownActors: knownActors.length > 0 ? knownActors : undefined,
  };

  const bundle = yes24.toBundle(
    {
      idPerf: show.source_id,
      url: show.url ?? yes24.detailUrl(show.source_id),
      name: show.name,
      startDate: show.start_date ?? "",
      endDate: show.end_date ?? "",
      venue: show.venue ?? "",
      address: show.address ?? "",
      price: show.price,
      organizer: show.organizer ?? "",
      cast: knownActors,
      poster: show.poster ?? "",
    },
    imagePaths,
  );

  const result = await transformCasting(bundle, ctx);
  saveCasting(show.id, result.data, "claude-p");
  discardImages([bundle]); // 판독 끝났으니 임시 이미지는 지운다
}

/** 추적 계정의 새 게시물을 읽어 이벤트로 저장한다. */
async function runX() {
  for (const seed of SNS_SEED) upsertAccount(seed.handle, seed.label);

  for (const account of listEnabledAccounts()) {
    try {
      const bundles = await collectAccount({ handle: account.handle, sinceId: account.last_seen_id ?? undefined });
      if (bundles.length === 0) {
        log.info("x-events", `@${account.handle} 새 게시물 없음`);
        continue;
      }

      const results = await transformPosts(bundles);
      saveEvents(account.handle, results);
      discardImages(bundles);

      // bundles는 최신순이므로 첫 항목이 가장 새 status ID다.
      updateLastSeen(account.handle, bundles[0]!.sourceId);
    } catch (err) {
      log.fail("cli", `@${account.handle} 수집 실패`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err: unknown) => {
  log.fail("cli", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
