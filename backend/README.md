# backend — 집 PC 수집기

무거운 일(스크래핑·AI 추출)은 전부 여기서 끝낸다. `web/`은 결과를 읽기만 한다.

전체 설계는 [`../docs/03-final-architecture-plan.md`](../docs/03-final-architecture-plan.md) 참고.

## KOPIS를 포기했다 — 예매처 발견 방식으로 전환 (2026-09-07)

KOPIS 웹사이트의 내부 공통코드 서비스(`kopis.or.kr:9001`)가 장애 상태라 신규 인증키 발급이 막혔다.
로컬에서는 타임아웃, Anthropic 외부 인프라에서는 ECONNREFUSED — **KOPIS 쪽 장애**로 확인했다
(실제 오픈API `www.kopis.or.kr/openApi/restful/...`는 완전히 정상 — 서비스 중단이 아니라 프런트엔드
내부 마이크로서비스 하나가 죽은 것으로 보인다). 자세한 진단은 `docs/03-final-architecture-plan.md`
§10 참고.

**복구를 기다리지 않고 NOL 장르 목록으로 발견(discovery)을 대체했다.**
`/ticket/genre/musical`, `/ticket/genre/play` — 콘서트 등은 URL 자체가 갈려 있어 연극·뮤지컬만
자동으로 걸러진다. 실측(2026-09-07): 뮤지컬 76건, 연극 61건, 브라우저 없이 GET 한 번.

## ETL 구조

②와 ③은 수집 방식이 완전히 다르지만(예매처=HTTP, X=HTTP), **산출물을 `ExtractedBundle`
하나로 통일**하고 그 뒤는 둘 다 `claude -p`로 판독 — 단, **NOL은 이미 구조화 데이터라 판독을
건너뛴다.**

```
                 Extract                         Transform         Load
② 예매처    2-1 nol(구조화) / yes24(이미지)   →  2-2 claude -p*  →  showtimes/castings/roles
             / ticketlink(상세만, 캐스팅 불가)     *nol은 건너뜀
③ X        3-1 syndication                    →  3-2 claude -p   →  events
                    ↓                                  ↓
             ExtractedBundle                    zod 검증된 JSON
```

수집과 판독을 나눈 이유: 캡처를 `fixtures/`에 넣어두면 사이트에 접속하지 않고 프롬프트만
반복해서 고칠 수 있고, Transform은 출처가 어디인지 몰라도 된다.

```
src/
  shared/
    claude.ts    claude -p 래퍼. AI 전송 수단은 이 파일 하나에 갇혀 있다
    db.ts        node:sqlite 저장소 (backend/data/collector.db)
    etl.ts       ExtractedBundle — ②③이 공유하는 Extract 산출물
    http.ts      node:http2 GET (X는 fetch가 막힌다)
    log.ts  sleep.ts  tmp.ts
  modules/
    kopis/            client.ts  sync.ts   — 코드는 있지만 지금 안 쓴다 (위 참고)
    ticket-casting/   nol.ts        발견 + 회차별 캐스팅 (구조화, AI 불필요)  (2-1)
                      yes24.ts      상세 JSON-LD + 캐스팅표 이미지            (2-1)
                      ticketlink.ts 상세 JSON-LD만 (회차별 캐스팅 불가)        (2-1)
                      discover.ts   (레거시) KOPIS 공연명 → 예매처 URL 검색
                      extract.ts    (레거시) Playwright 범용 캡처 — 미검증
                      transform.ts  claude -p 이미지 판독                    (2-2)
                      load.ts       showtimes/castings/roles 저장
                      schema.ts
    x-events/         syndication.ts  playwright.ts  extract.ts             (3-1)
                      transform.ts                                          (3-2)
                      load.ts       sns_accounts/events 저장
                      schema.ts
  cli.ts         npm run collect -- --job=discover|casting|x
tests/           모듈별 테스트. 네트워크·AI를 쓰는 live 테스트는 기본 skip
fixtures/        판독 테스트용 실제 캡처/HTML
```

## 파이프라인 종단 실증 (2026-09-07)

`discover` → `casting` → `x` 를 실제로 끝까지 돌려 DB에 저장되는 것까지 확인했다.

| 단계 | 결과 |
|---|---|
| `discover` | shows **140건** (NOL 뮤지컬 76 + 연극 61, 예스24 시드 1, 티켓링크 시드 2) |
| `casting`(NOL 표본 3건) | 웨스턴 스토리: 회차 69·캐스팅 483·배역 7 — 구조화 API, AI 미사용, 즉시 저장 |
| `casting`(예스24 1건) | 곤 투모로우: 회차 52·캐스팅 260·배역 5 — `claude -p` 판독, 95초 |
| `x`(2계정) | 새 게시물 판독 → events 저장 |

전량(140건)을 다 돌리면 예의상 간격(요청당 3초)만으로 15분 이상 걸린다 — 사이트에 부담을
주지 않으려는 의도된 설계다. 실제 배치는 이 페이스로 밤 시간대에 돈다.

## 2026-09-07 실측 — 사이트별로 정반대인 것들

같은 프로젝트 안에서 두 사이트가 **정확히 반대로** 동작한다.

| | 티켓링크 | X 신디케이션 |
|---|---|---|
| Playwright | ❌ `/500`으로 튕김 (headless/headful 모두) | ⚠️ 되지만 6건·본문 못 읽음 |
| Node `fetch` | ✅ 200 | ❌ **항상 429** |
| `node:http2` | ❌ 프로토콜 에러 (HTTP/1.1만) | ✅ 200 |
| 결론 | **fetch + JSON-LD** | **http2 + `__NEXT_DATA__`** |

### 예매처 3사

| 예매처 | 회차별 캐스팅 | 방법 | AI 판독 |
|---|---|---|---|
| **NOL(인터파크)** | ✅ 구조화 JSON | `/ticket/products/api/casting-schedule?goodsKey={goods}:{place}&...` | **불필요** |
| **예스24** | ✅ 캐스팅표 이미지 | `/New/Perf/Detail/Ajax/axPerfContents.aspx?IdPerf={id}` → `PerfCasting` | 필요 |
| **티켓링크** | ❌ 전체 출연진까지만 | 정적 HTML JSON-LD | — |

- **NOL**은 목록도 캐스팅도 전부 구조화 JSON. `nol.ts`가 정적 SSR HTML에 박힌
  `self.__next_f.push([1,"..."])` 조각을 정규식으로 파싱한다 (`"id":"{goodsCode}:{placeCode}"`
  형태가 캐스팅 API의 `goodsKey` 그 자체). `castingList[].characterName`/`manName`이 이미
  구조화돼 있어 오독 위험이 없다 — 2-2(claude -p)를 아예 건너뛴다.
- **예스24**는 이미지 한 장에 전 회차 표가 들어 있어 2-2의 주 입력이 된다. 응답 본문에
  리터럴 CR/LF가 섞여 있어 그냥 `JSON.parse`가 안 된다 — 사이트 자체 JS처럼
  `\r`/`\n`을 이스케이프한 뒤 파싱한다(`yes24.ts`의 `parsePerfContents`).
  **2-2 실측**(곤 투모로우, 960×3514 이미지): 회차 52건 전부 형식 통과, 배역 5개 분리,
  첫공·막공·사인회·스페셜 커튼콜 note 이관, 월요일 "공연없음" 제외.
- **티켓링크**는 안티봇(rfQNS WAF)이 **자동화 브라우저만** 막는다. 단순 GET은 통과해서
  JSON-LD로 상세정보는 얻지만, 회차별 캐스팅 이미지는 JS 렌더링이 필요해 못 가져온다.
  → 캡처를 `fixtures/ticket-casting/`에 사람이 넣거나, 모듈 ③(제작사 X 계정)으로 메운다.

### X 신디케이션

- `syndication.twitter.com/srv/timeline-profile/screen-name/{handle}` → `__NEXT_DATA__`에
  타임라인 JSON 통째로. 로그인·브라우저 불필요.
- **100건** / `full_text` 완전 / `id_str` / `created_at` / `media_url_https`.
  Playwright 방식(6건, 본문 못 읽음)보다 명백히 낫다 → 주 경로, Playwright는 폴백.
- Node `fetch`(undici)로는 헤더를 어떻게 맞춰도 429. 같은 IP에서 curl·node:http2는 200.
  IP 제한이 아니라 undici가 걸러진다. → `shared/http.ts`
- 이미지 다운로드(`pbs.twimg.com`)는 `fetch`로 정상.
- ⚠️ `@elonmusk` 기준 최신 게시물이 4일 전 — 캐시 지연이 있다. 운영 전 재측정 필요.

## AI 추출은 API 키를 쓰지 않는다

개발 중에는 Anthropic API 대신 **이미 로그인된 Claude Code CLI를 `claude -p`로 실행**한다.
별도 키도, 별도 과금도 없다. 전송 수단은 `shared/claude.ts`의 `runClaudeJson()` 하나에 갇혀 있어서,
나중에 API로 옮길 때 이 함수 내부만 갈아끼우면 된다. 프롬프트와 zod 스키마는 그대로 쓴다.

SDK의 structured output과 달리 **CLI는 스키마 준수를 보장하지 않는다.** 그래서 `runClaudeJson()`은
응답을 항상 zod로 검증하고, 실패하면 무엇이 틀렸는지 알려주고 1회만 재시도한다.

> Windows 주의: PATH의 `claude.cmd`는 배치 샤임이라 shell 없이 spawn하면 `EINVAL`이 난다.
> 패키지 안의 진짜 실행 파일(`.../claude-code/bin/claude.exe`)을 찾아 쓴다.

## 설정

```bash
npm install
npx playwright install chromium     # 폴백/미조사 예매처용 (지금은 안 쓴다)
claude --version                    # AI 추출에 이게 필요하다
```

## 실행

```bash
npm run collect -- --job=discover   # NOL 장르 목록(뮤지컬/연극) → shows 등록. 예스24/티켓링크는 시드만
npm run collect -- --job=casting    # shows 전량의 회차별 캐스팅 갱신 (NOL 구조화 / 예스24 claude -p)
npm run collect -- --job=x          # 추적 계정 새 게시물 → 이벤트 저장

npm test                            # 순수 로직만 (빠름, 네트워크·AI 없음)
npm run typecheck
```

수집 결과는 `backend/data/collector.db`(SQLite)에 쌓인다. `cli.ts`의 `YES24_SEED_IDS` /
`TICKETLINK_SEED_IDS` / `SNS_SEED`가 지금의 추적 대상 목록이다 — 새 공연·계정은 여기 추가한다.

### live 테스트

네트워크와 AI를 실제로 쓰는 테스트는 기본적으로 skip된다.

```bash
RUN_LIVE=1 npm test                              # claude -p, 각 예매처, AI 판독
RUN_LIVE=1 X_TEST_HANDLE=nangman_b20 npm test    # X 실수집
HEADFUL=1 ...                                    # 브라우저를 눈으로 보며 셀렉터 조사 (레거시 모듈용)
```

## 지켜야 할 것

- **순차 처리, 요청 간 3초 이상.** 동시 요청을 던지지 않는다. (`shared/sleep.ts`)
- **조용한 빈 결과 금지.** 셀렉터·JSON-LD·구조화 API가 안 잡히면 빈 배열이 아니라 에러를 던진다.
  조용히 실패하면 데이터가 비어가는 걸 몇 주 뒤에나 알게 된다.
- **이미 본 것은 다시 요청하지 않는다.** `ExtractedBundle.sourceId` / DB의 `(source, source_id)`가
  중복 방지 키다.
- **실패 시 즉시 재시도 금지.** 다음 배치로 미룬다. (429 포함)

## 아직 안 된 것

1. **NOL 발견의 페이지네이션** — 장르 목록 1페이지(뮤지컬 76·연극 61)만 쓴다. "더보기" 시
   호출되는 별도 API를 못 찾았다. 커버리지가 부족하면 재조사한다.
2. **X 이벤트 ↔ 공연 자동 매칭이 약하다** — `events.show_id`는 게시물의 `showName`과
   `shows.name`의 단순 부분일치로 채운다(`x-events/load.ts`). 오탐/누락 가능성이 있다.
3. **멜론티켓 미조사.**
4. **KOPIS 복구 시 재통합** — `modules/kopis/`는 그대로 남아 있다. 서비스가 복구되면 발견 축을
   NOL과 병행하거나 대체할 수 있다.
5. **`web/` 연동 — 반쪽만 됐다 (2026-09-09)** — `web/`은 이제 Supabase를 직접 읽어 실제로 뜬다
   (https://lucy980616-prog.github.io/performance-schedule-project/, 자세한 경위는
   `docs/03-final-architecture-plan.md` §11). 하지만 이 backend는 여전히 `data/collector.db`
   (SQLite)에만 쓴다 — Supabase에 있는 데이터는 그 시점 SQLite 스냅샷을 1회성으로 옮긴 것이다.
   다음 수집 배치부터 자동으로 반영되게 하려면 `shared/db.ts`(또는 각 모듈 `load.ts`)를
   `service_role` 키로 Supabase에 쓰도록 바꿔야 한다.
