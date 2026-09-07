# 공연 스케줄 서비스 — 최종 아키텍처 계획서

- 작성일: 2026-08-31
- 목적: 서비스 종료된 뮤킷(myukit.com)의 핵심 기능을 개인용으로 재구축
- 확정 사항: **수집기 = 집 PC / DB = Supabase / 배포 = GitHub Pages**

---

## 0. 한 장 요약

```
┌─────────────────────────────────────────────────────────┐
│ backend/ — 집 PC 수집기 (하루 1회, 시간차 분산)           │
│                                                          │
│  ① modules/kopis          KOPIS 오픈API → 공연 마스터     │
│  ② modules/ticket-casting Playwright 캡처 → claude -p     │
│                           → 회차별 캐스팅                 │
│  ③ modules/x-events       Playwright 크롤링 → claude -p   │
│                           → 이벤트(커튼콜·팬사인·할인)     │
│                                                          │
│  공통: shared/claude.ts — AI 전송 수단은 여기 한 곳뿐      │
│                          ↓ 직접 INSERT                    │
└──────────────────────────┼───────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ Supabase                                                 │
│  · Postgres (공연/회차/캐스팅/이벤트)                      │
│  · Storage  (수집한 이미지 원본)                          │
│  · Auth     (본인 로그인 — 개인 일정 보호용)               │
│  · RLS      (공개 데이터는 읽기전용, 개인 데이터는 본인만)   │
└──────────────────────────┬───────────────────────────────┘
                           ↓ 브라우저에서 직접 조회 (supabase-js)
┌─────────────────────────────────────────────────────────┐
│ GitHub Pages — 정적 앱 (React + shadcn/ui)               │
│  폰/PC 어디서나 접속. 서버 없음.                           │
└─────────────────────────────────────────────────────────┘
```

**핵심 원칙**: 무거운 일(스크래핑·AI 추출)은 전부 `backend/`에서 끝내고, Supabase에는 **결과만** 저장한다.
`web/`은 읽기만 한다. 두 폴더는 서로의 코드를 import하지 않는다 — 공유해야 할 것은 DB 스키마뿐이다.

---

## 1. 왜 이 구조인가

| 구성요소 | 선택 | 이유 |
|---|---|---|
| 수집기 | 집 PC (Playwright) | X·예매처는 데이터센터 IP를 차단한다. 실측 결과 집 IP에서는 비로그인으로도 게시물+이미지 URL이 정상 수집됨 |
| DB | Supabase | Postgres + 자동 REST API. 정적 사이트에서 서버 없이 직접 조회 가능 |
| 배포 | GitHub Pages | 무료, 상시 가동, 집 PC가 꺼져 있어도 앱은 살아있음 |
| AI 추출 | 집 PC에서 `claude -p` | 개발 중에는 Anthropic API를 직접 호출하지 않고 이미 설치된 Claude Code CLI를 서브프로세스로 쓴다. 별도 API 키·과금이 없다. 어차피 브라우저에 키를 노출할 수 없어 수집기 안에서 돌려야 한다 (→ §2 ④) |

### GitHub Pages 제약과 해법

GitHub Pages는 **정적 파일만** 서빙한다. 서버 코드가 없다.

| 안 되는 것 | 해법 |
|---|---|
| Next.js 서버 컴포넌트 / API 라우트 | 정적 빌드(`output: 'export'`)로 전환, 데이터는 브라우저에서 Supabase 직접 조회 |
| 브라우저에서 AI 호출 | 호출하지 않는다. AI 추출은 집 PC 수집기의 `claude -p` 모듈에서만 |
| 비밀키 보관 | Supabase `anon key`만 노출(정상 설계). 나머지 키는 집 PC `.env`에 |

> ⚠️ **GitHub Pages로 배포된 사이트는 저장소가 private이어도 공개 URL로 열립니다.**
> 관람 일정 같은 개인 데이터가 있으므로 **Supabase Auth + RLS를 반드시 설정**해야 합니다.
> (공연/캐스팅 = 익명 읽기 허용, 내 달력/애배 = 로그인한 본인만)

---

## 2. 데이터 파이프라인 3종

### ① KOPIS — 공식 공연 정보 (문제 없음)

- 공연목록 `pblprfr`, 공연상세 `pblprfr/{id}`
- 확보 필드: 공연명·기간·장소·포스터·가격·러닝타임·관람연령·**전체 출연진(prfcast)**·제작진·요일별 공연시간(dtguidance)
- 인증키 발급: https://www.kopis.or.kr/por/cs/openapi/openApiUseSend.do (PC에서만, 1인 1키)
- **출처 명시 의무**: `출처: (재)예술경영지원센터 공연예술통합전산망(www.kopis.or.kr)`
- 이미 구현 완료 (`src/lib/kopis.ts`)

**KOPIS의 한계** → 아래 ②가 필요한 이유:
KOPIS는 "이 작품에 나오는 배우 명단"만 주고 **"몇 월 며칠 몇 시 회차에 누가 나오는지"는 주지 않는다.**

### ② 예매처 — 회차별 캐스팅

- 대상: 사용자가 지정한 4개 상세페이지로 2026-09-07 전수 실측 완료.

#### 결론 먼저 — 예매처 3사가 전부 다르다

| 예매처 | 회차별 캐스팅을 주는가 | 방법 | AI 판독 |
|---|---|---|---|
| **NOL(인터파크)** | ✅ **구조화 JSON API** | `GET /ticket/products/api/casting-schedule` | **불필요** |
| **예스24** | ✅ 캐스팅표 이미지 | `GET /New/Perf/Detail/Ajax/axPerfContents.aspx?IdPerf={id}` → `PerfCasting` | 필요 (2-2) |
| **티켓링크** | ❌ 작품 전체 출연진까지만 | 정적 HTML JSON-LD | — |

셋 다 **브라우저가 필요 없다.** 단순 HTTP GET으로 끝난다.

#### ① NOL(인터파크) — 가장 좋은 소스

```
GET https://nol.yanolja.com/ticket/products/api/casting-schedule
      ?goodsKey={goodsCode}:{placeCode}&startDate=...&endDate=...
```

응답(실측, 84KB):

```json
{"playSeq":"091","playDate":"2026-09-08","playTime":"19:30","dayOfWeek":"화",
 "castingList":[{"characterName":"제인 존슨","manName":"표바하","manLargeImageUrl":"..."},
                {"characterName":"빌리 후커","manName":"홍기범","manLargeImageUrl":"..."}]}
```

**날짜·시간·배역·배우가 이미 구조화되어 있다.** AI 판독도, 이미지 OCR도 필요 없고 오독 위험도 없다.
배우 프로필 이미지 URL까지 딸려 온다. `goodsKey`는 상세페이지 HTML에서 얻고,
`casting-min-max?goodsKey=...&type=castingSchedule`로 조회 가능 기간을 먼저 확인한다.

#### ② 예스24 — 캐스팅표 이미지

```
GET https://ticket.yes24.com/New/Perf/Detail/Ajax/axPerfContents.aspx?IdPerf=59596
→ {"PerfCasting":"<img src=\"https://tkfile.yes24.com/Upload2/Board/.../59596_Sc.jpg\">", ...}
```

이미지 한 장에 전 회차 캐스팅표가 들어 있다. 이게 2-2(`claude -p`)의 주 입력이다.
JSON-LD에도 `performer` 배열(배우 18명)·기간·장소·가격이 있어 보조로 쓴다.

**실측 판독 결과** (뮤지컬 곤 투모로우, 960×3514 이미지, 120초 소요):
- 회차 **52건 전부 형식 검증 통과**, 배역 5개(김옥균/한정훈/고종/이완/와다) 정확히 분리
- 첫공·막공·사인회·스페셜 커튼콜·마티네 배지를 `note`로 이관
- 월요일 "공연없음" 행을 회차로 만들지 않음
- warnings에 판독 애매점을 정직하게 보고 (저해상도 이름 혼동, 빈 칸, 이미지에 없는 기간)

#### ③ 티켓링크 — 1차 판단을 뒤집는다

#### 티켓링크 — 1차 판단을 뒤집는다

1차 조사에서 "봇 탐지로 제외"라고 적었는데, 실제 상세페이지 2건으로 재실측한 결과
**절반은 맞고 절반은 틀렸다.**

| 접근 | 결과 |
|---|---|
| Playwright headless | ❌ 상세페이지가 `/500`으로 리다이렉트 |
| Playwright headful | ❌ 동일 (`--disable-blink-features`, webdriver 은닉 모두 무효) |
| 브라우저 안의 내부 API `mapi.ticketlink.co.kr/mapi/product/{id}/detail` | ❌ 에러 JSON 122B |
| 그 API를 직접 호출 | ❌ WAF 동적 토큰 필요 (`code: 7200 요청 데이터가 잘못되었습니다`) |
| **정적 HTML을 단순 GET** | ✅ **200, JSON-LD 완비** |

즉 **브라우저를 띄우는 순간 막히고, 안 띄우면 통과한다.** 안티봇(rfQNS 계열 WAF)이 걸러내는 건
자동화된 브라우저지 HTTP 요청이 아니다. 그래서 티켓링크는 **Playwright를 쓰지 않는다.**

정적 HTML의 schema.org JSON-LD에서 얻는 것 (실측):

```
product/65490  뮤지컬 <죽음에 관하여> '삶과 죽음의 경계선 DAY' 2nd
               2026-09-24 ~ 2026-10-04 / 링크아트센터드림 드림3관 / 66,000원
               주최: 주식회사 낭만바리케이트
               performer: 성태준 조성윤 유승현 | 강찬 박좌헌 신주협

product/65165  뮤지컬 <렛미플라이>
               2026-10-06 ~ 2027-01-03 / 두산아트센터 연강홀 / 88,000원
               주최: 유한회사 렛미플라이
               performer: 안재욱 이희준 오의식 이형훈 배해선 윤공주 김지현
                          윤소호 안지환 윤재호 홍지희 나하나 이수빈 박슬기
```

> ⚠️ HTTP/2로 붙으면 프로토콜 에러가 난다. 티켓링크는 HTTP/1.1이라 `fetch`를 쓴다.
> (X 신디케이션은 정반대로 `fetch`가 막혀서 `node:http2`를 쓴다 — §2 ③)

#### 그런데 이걸로도 회차별 캐스팅은 못 얻는다

JSON-LD의 `performer`는 **작품 전체 출연진**이지 "9월 27일 3시에 누가 나오는지"가 아니다.
그 정보는 상세 설명 영역의 캐스팅표 이미지에 있고, 그건 JS 렌더링이 필요해서 WAF에 막힌다.
**KOPIS의 `prfcast`와 정확히 같은 한계에 다시 부딪힌 것이다.**

회차별 캐스팅은 아래로 채운다:

| 방법 | 상태 |
|---|---|
| (a) 사람이 캐스팅표 캡처를 `fixtures/`에 넣고 2-2로 판독 | ✅ 지금 방식. 파이프라인은 완성됨 |
| (b) **모듈 ③ — 제작사 X 계정** | ✅ 유력. 실측에서 `러브 | #홍지희 / 마마 | #정인지` 형태로 올라옴 |
| (c) 인터파크/예스24에 같은 공연이 있으면 그쪽 | ⬜ 미조사 |

(b)가 특히 중요하다. 사용자가 준 X 계정 2개가 **티켓 링크 2개의 제작사와 정확히 일치**한다
(`@nangman_b20` = 낭만바리케이트 = 죽음에 관하여 / `@letmefly_m` = 렛미플라이).
즉 ②의 빈칸을 ③이 메우는 구조가 실제로 성립한다.

**2-1 Extract — 상세페이지를 어떻게 찾고 무엇을 가져오는가**

KOPIS는 공연ID(mt20id)만 주고 예매처 링크를 주지 않는다. 그래서 두 단계다.

1. **연결(discover)**: 공연명으로 예매처를 검색 → 결과 제목과 비교해 상세페이지 URL을 고른다.
   제목 표기가 제각각(`뮤지컬 <지킬앤하이드>` vs `지킬 앤 하이드 [서울]`)이라 정규화 후
   문자 바이그램 자카드 유사도로 점수를 매긴다. **0.6 미만이면 매칭 실패로 보고 비워 둔다.**
   억지로 이으면 다른 공연의 캐스팅이 DB에 들어가는데, 이건 아무것도 없는 것보다 나쁘다.
   실패분은 사람이 `OVERRIDES`에 직접 URL을 넣는다.
2. **수집(capture)**: 상세페이지에 진입해 캐스팅표를 원본 그대로 확보한다. 형태가 세 가지다.

   | 형태 | 빈도 | 처리 |
   |---|---|---|
   | (a) 상세 설명 안 통이미지 한 장 | 가장 흔함 | 이미지 URL을 받아 로컬 저장 |
   | (b) HTML 표 | 가끔 | 텍스트로 긁는다. 판독이 제일 정확하므로 우선 |
   | (c) 캘린더 위젯 | 가끔 | 컨테이너 스크린샷 |

   셋 다 모아 `ExtractedBundle` 하나로 만든다. 어느 쪽을 쓸지는 2-2가 정한다
   (텍스트가 200자 이상이고 이미지가 없으면 텍스트, 아니면 이미지).

**2-2 Transform** — `claude -p`로 판독 → zod 검증 → 회차별 캐스팅 JSON.
이 단계는 인터파크에서 왔는지 예스24에서 왔는지 모른다. 새 예매처가 늘어도 손대지 않는다.

> ⚠️ **미조사**: 예매처 3사의 검색 URL·결과 셀렉터·상세페이지 셀렉터는 전부 추정값이다.
> 사용자가 샘플 상세페이지 링크를 주면 그걸로 실물 구조를 맞춘다.

### ③ X(트위터) — 이벤트/공지 (2026-09-07 재실측: **신디케이션으로 전환**)

당초엔 Playwright 비로그인 크롤링을 계획했으나, 재조사 결과 **훨씬 나은 경로**를 찾았다.

`https://syndication.twitter.com/srv/timeline-profile/screen-name/{계정}` 은 트윗 임베드용
공개 엔드포인트다. 응답 HTML의 `__NEXT_DATA__` 안에 타임라인 JSON이 통째로 들어 있다.

| 항목 | Playwright 비로그인 | **신디케이션 (채택)** |
|---|---|---|
| 게시물 수 | 6건 (스크롤 불가) | **100건** |
| 본문 텍스트 | ❌ `data-testid="tweetText"`로 안 잡힘 | ✅ `full_text` 완전 |
| status ID | ✅ | ✅ `id_str` |
| 게시 시각 | ✅ | ✅ `created_at` |
| 첨부 이미지 | ✅ | ✅ `media_url_https` |
| 필요한 것 | 브라우저 기동 | **GET 한 번** |

**이 전환으로 "본문 텍스트 셀렉터 재조사"라는 미해결 항목이 통째로 사라졌다.**

실측 기록 (2026-09-07):
- `@elonmusk` 100건, 최신 게시물 2026-09-03 → **약 4일 지연**. 캐시가 끼는 것으로 보인다.
  하루 1회 수집에는 지장 없지만, 운영 전에 지연폭을 한 번 더 재봐야 한다.
- 없는 계정/보호계정은 2KB짜리 빈 셸(entries 0)을 준다 → 조용히 넘기지 말고 폴백으로 넘긴다.
- **⚠️ Node 내장 `fetch`(undici)로는 헤더를 어떻게 맞춰도 무조건 429.** 같은 시각 같은 IP에서
  `curl`과 `node:http2`는 200(570KB). IP 제한이 아니라 undici가 걸러지는 것이다.
  → `shared/http.ts`의 `http2Get()`(내장 `node:http2`)을 쓴다. 추가 의존성 없음.
- 이미지 다운로드(`pbs.twimg.com`)는 `fetch`로 정상 동작한다.

Playwright 경로는 **폴백으로 남겨 둔다** (`x-events/playwright.ts`). 신디케이션은 공식 문서가
없는 내부 엔드포인트라 언제든 막힐 수 있다.

- **이미지 원본 받기**: URL 끝에 `name=large` 를 붙인다
- **중복 제외**: `sinceId`(마지막으로 본 status ID)보다 큰 것만 가져온다 — 실측 검증 완료
- **리트윗 제외**: 기본값. 남의 글까지 판독할 이유가 없다
**추적 계정 (사용자 지정, 2026-09-07 실측 완료)**

| 계정 | 제작사 | 신디케이션 | 비고 |
|---|---|---|---|
| `@nangman_b20` | 낭만바리케이트 | ✅ 91건 | 티켓링크 65490(죽음에 관하여) 제작사 |
| `@letmefly_m` | 렛미플라이 | ✅ 100건 | 티켓링크 65165(렛미플라이) 제작사 |

두 계정 다 본문·이미지·게시시각이 정상적으로 나온다. 실제 게시물 내용도 목표 데이터와 일치했다
— 티켓오픈 안내, 막공 안내, 그리고 **`러브 | #홍지희 / 마마 | #정인지` 형태의 회차 캐스팅**.
②(예매처)에서 못 얻는 회차별 캐스팅을 ③이 메울 수 있다는 근거다.

계정 목록은 `sns_accounts` 테이블로 관리한다.

> ⚠️ **x.com robots.txt는 `User-agent: * → Disallow: /`** 로 일반 크롤러를 명시적으로 금지하며 `Crawl-delay: 1`을 명시하고 있습니다.
> 개인용 수집이라도 이 사실을 알고 진행해야 하며, 최소한 아래를 지킵니다:
> - 계정 간 요청 간격 **최소 3초 이상**
> - 하루 1회, 시간대 분산
> - 동시 요청 금지 (순차 처리)
> - 이미 본 게시물(status ID)은 재요청하지 않음

### ④ AI 추출 계층 — 개발 중에는 `claude -p` (Anthropic API 아님)

②·③에서 확보한 캐스팅표/게시물 이미지를 JSON으로 바꾸는 일은 **Anthropic API(`@anthropic-ai/sdk`)를
직접 호출하지 않는다.** 이미 설치되어 로그인된 Claude Code CLI를 `claude -p`(non-interactive print 모드)로
실행하는 얇은 모듈로 감싸서 쓴다.

| | Anthropic API 직접 호출 | `claude -p` 모듈 (채택) |
|---|---|---|
| 키 | `ANTHROPIC_API_KEY` 발급·보관 필요 | 불필요. CLI가 이미 로그인돼 있음 |
| 비용 | 사용량 기반 별도 청구 | Claude Code 구독에 포함 — 추가 과금 없음 |
| 호출 | HTTPS 요청 | 자식 프로세스 spawn + stdout 파싱 |
| 구조화 출력 | `output_config` + zod (SDK가 스키마 준수 보장) | 프롬프트로 JSON 강제 → 파싱 → zod로 **사후 검증** |
| 이미지 입력 | base64 인라인 | 임시 파일로 저장하고 경로를 프롬프트에 전달 (Read 툴 허용) |

#### 모듈 계약 — `src/lib/claude.ts` (신규)

전송 수단을 이 파일 하나에 가둔다. 호출부(`extract.ts` 등)는 자기가 CLI를 쓰는지 API를 쓰는지 몰라야 한다.

```ts
// 프롬프트를 넣으면 검증된 JSON을 돌려주는 것, 그 하나만 한다.
runClaudeJson<T>(opts: {
  system: string;        // --append-system-prompt 로 전달
  prompt: string;        // stdin 으로 전달 (인자로 넘기면 길이/따옴표 문제가 생긴다)
  schema: ZodType<T>;    // 파싱 결과 검증. 실패 시 1회 재시도 후 throw
  imagePaths?: string[]; // 있으면 경로를 프롬프트에 넣고 Read 툴을 허용
  model?: string;        // 기본 'opus'
  timeoutMs?: number;    // 기본 300_000 — 서브프로세스라 API보다 느리다
}): Promise<T>
```

실행 형태:

```bash
claude -p   --output-format json   --append-system-prompt "<시스템 프롬프트>"   --model opus   --allowed-tools Read   --disallowed-tools Bash Edit Write WebFetch WebSearch
# 프롬프트 본문은 stdin 으로 넣는다
```

#### 지켜야 할 것

- **봉투와 알맹이를 구분해서 파싱한다.** `--output-format json`은 `result` / `is_error` /
  `total_cost_usd` 등을 담은 바깥 JSON을 준다. 모델이 만든 JSON은 그 `result` 문자열 안에 들어 있다.
  `is_error`면 stdout 전체를 로그에 남기고 중단한다.
- **스키마 준수가 보장되지 않는다.** 이게 이 방식의 유일한 실질적 단점이다.
  result에 코드펜스가 붙어 오는 경우가 있으니 벗겨낸 뒤 파싱하고, 결과는 반드시 zod로 검증한다.
  검증 실패 시 "직전 출력이 스키마에 맞지 않는다"는 지적과 함께 1회만 재시도한다.
- **툴은 필요한 것만 허용한다.** 이미지 입력이 있을 때만 Read를 열고, 쓰기·네트워크 툴은 전부 막는다.
  수집기가 임의로 파일을 건드리면 안 된다.
- **이미지는 임시 디렉터리에 떨어뜨리고 경로를 넘긴 뒤 지운다.**
- **CLI가 없거나 로그인이 안 돼 있으면 조용히 빈 결과를 반환하지 말고 즉시 에러를 낸다.**
  (X 셀렉터 원칙과 동일 — 조용한 실패가 제일 나쁘다)
- 순차 처리 전제다. 서브프로세스를 동시에 여러 개 띄우지 않는다.

#### 나중에 API로 되돌릴 때

호출부는 `runClaudeJson()`만 알고 있으므로 이 함수 내부를 `@anthropic-ai/sdk` 호출로 갈아끼우면 끝난다.
프롬프트와 zod 스키마(`src/lib/extract.ts`)는 손대지 않는다.
전환 시점은 **(a) 사람이 없는 무인 배치로 상시 운영할 때**, 또는 **(b) 스키마 준수율이 실측에서 문제될 때**다.

---

## 3. DB 스키마 (Supabase / Postgres)

현재 SQLite 스키마를 Postgres로 옮기고 이벤트 관련 테이블을 추가한다.

```sql
-- ── 공연 (KOPIS) ─────────────────────────────────────────
create table shows (
  id            text primary key,          -- KOPIS mt20id
  name          text not null,
  genre         text,
  poster        text,
  area          text,
  start_date    date,
  end_date      date,
  facility      text,
  facility_id   text,
  state         text,                      -- 공연예정/공연중/공연완료
  runtime       text,
  age           text,
  price         text,
  cast_raw      text,                      -- KOPIS prfcast
  crew_raw      text,
  company       text,
  story         text,
  time_guidance text,                      -- 요일별 공연시간 패턴
  tracked       boolean not null default false,
  synced_at     timestamptz default now()
);

-- ── 회차 ────────────────────────────────────────────────
create table showtimes (
  id       bigserial primary key,
  show_id  text not null references shows(id) on delete cascade,
  date     date not null,
  time     text not null,                  -- 'HH:MM'
  note     text,                           -- 커튼콜/대역 등
  unique (show_id, date, time)
);

-- ── 회차별 캐스팅 (KOPIS에 없는 정보) ──────────────────────
create table castings (
  showtime_id bigint not null references showtimes(id) on delete cascade,
  actor       text not null,
  role        text,
  source      text,                        -- 'interpark' | 'yes24' | 'manual' | 'x'
  unique (showtime_id, actor)
);

create table roles (
  show_id text not null references shows(id) on delete cascade,
  role    text not null,
  actor   text not null,
  ord     int not null default 0,
  unique (show_id, role, actor)
);

-- ── SNS 추적 ────────────────────────────────────────────
create table sns_accounts (
  handle       text primary key,           -- '@' 없이
  platform     text not null default 'x',
  label        text,                       -- '00제작사'
  enabled      boolean not null default true,
  last_seen_id text,                       -- 마지막으로 본 status ID
  last_run_at  timestamptz
);

create table sns_posts (
  id          text primary key,            -- X status ID (중복 방지 키)
  handle      text not null references sns_accounts(handle),
  url         text not null,
  posted_at   timestamptz,
  text        text,
  image_urls  text[],
  raw_json    jsonb,                       -- AI 추출 원본
  collected_at timestamptz default now()
);

-- ── 이벤트 (AI가 게시물에서 뽑아낸 구조화 결과) ─────────────
create table events (
  id          bigserial primary key,
  post_id     text references sns_posts(id) on delete cascade,
  show_id     text references shows(id),   -- 매칭되면 연결
  kind        text,                        -- 커튼콜/팬사인/프레스콜/할인/캐스팅변경
  title       text not null,
  date        date,
  time        text,
  description text,
  confidence  real,                        -- AI 확신도
  verified    boolean not null default false,
  created_at  timestamptz default now()
);

-- ── 개인 데이터 (RLS로 본인만) ───────────────────────────
create table favorite_actors (
  user_id    uuid not null references auth.users(id),
  name       text not null,
  created_at timestamptz default now(),
  primary key (user_id, name)
);

create table my_schedule (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id),
  show_id    text not null references shows(id) on delete cascade,
  date       date not null,
  time       text not null,
  seat       text,
  memo       text,
  unique (user_id, show_id, date, time)
);
```

### RLS 정책 (필수)

```sql
-- 공개 데이터: 익명 읽기 허용, 쓰기는 service_role(수집기)만
alter table shows enable row level security;
create policy "public read" on shows for select using (true);
-- showtimes, castings, roles, sns_posts, events 도 동일하게

-- 개인 데이터: 본인만
alter table my_schedule enable row level security;
create policy "own rows" on my_schedule
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- favorite_actors 도 동일하게
```

> 수집기는 **service_role 키**로 쓰기(이 키는 집 PC에만 보관, 절대 프론트에 넣지 않음),
> 웹앱은 **anon 키**로 읽기.

---

## 4. 지금 코드에서 바꿔야 할 것

이미 만든 `web/`는 Next.js 서버 렌더링 + 로컬 SQLite 기준이라 다음 작업이 필요하다.

| 현재 | 변경 후 | 작업량 |
|---|---|---|
| `node:sqlite` (`src/lib/db.ts`) | Supabase Postgres | 스키마 이식 (위 SQL) |
| `src/lib/queries.ts` 직접 SQL | `supabase-js` 쿼리 | 재작성 |
| 서버 컴포넌트에서 DB 조회 | 클라이언트 컴포넌트 + `supabase-js` | 페이지별 전환 |
| `src/app/api/*` 라우트 | `backend/` 모듈로 이동 | 이동 |
| `web/` 한 폴더에 앱+수집기 혼재 | `web/`(읽기 전용 앱) + `backend/`(수집기) 분리 | 완료 |
| `next build` (SSR) | `output: 'export'` 정적 빌드 | 설정 |
| `@anthropic-ai/sdk` 직접 호출 (`extract.ts`) | `claude -p` 서브프로세스 모듈 (`lib/claude.ts`) | 전송 계층만 교체, 프롬프트·스키마는 유지 |

**그대로 재사용 가능한 자산** (이미 검증 완료):
- `src/lib/kopis.ts` — KOPIS 클라이언트 (XML 파싱, 장르/상태 코드)
- `src/lib/schedule.ts` — 요일 패턴 → 회차 생성 (실측 테스트 통과)
- `src/lib/extract.ts` — 프롬프트와 zod 스키마는 그대로. 단 전송부(`client.messages.parse`)만 `runClaudeJson()` 호출로 교체
- `src/components/casting-calendar.tsx` — 캐스팅 로테이션 달력 (렌더링 확인 완료)
- 나머지 UI 컴포넌트 전부

---

## 5. 수집기 설계 — `backend/`

`web/`(Next.js 앱)과 완전히 분리된 별도 패키지다. 수집기는 Node 스크립트일 뿐 웹 프레임워크가 필요 없고,
앱이 정적 빌드로 바뀌어도 수집기는 영향을 받지 않아야 하기 때문이다.

### 폴더 구조

```
backend/
  src/
    shared/
      claude.ts          claude -p 래퍼. AI 전송 수단은 이 파일 하나에 갇혀 있다
      etl.ts             ExtractedBundle — ②③이 공유하는 Extract 산출물
      http.ts            node:http2 GET (X는 undici로 요청하면 429가 온다)
      log.ts sleep.ts tmp.ts
    modules/
      kopis/             client.ts  sync.ts  index.ts
      ticket-casting/    discover.ts  extract.ts   (2-1)
                         transform.ts             (2-2)
                         schema.ts  index.ts
      x-events/          syndication.ts  playwright.ts  extract.ts  (3-1)
                         transform.ts                              (3-2)
                         schema.ts  index.ts
    cli.ts               npm run collect -- --job=kopis|casting|x
  tests/                 모듈별 테스트. 네트워크·AI를 쓰는 live 테스트는 기본 skip
  fixtures/              판독 테스트용 실제 캡처 이미지
```

### 모듈 3개 — ②③은 ETL로 쪼갠다

| 모듈 | 무엇을 | 깨질 위험 |
|---|---|---|
| `kopis` | 공연 마스터 (공연명·기간·장소·전체 출연진·요일별 공연시간) | 낮음 (공식 API) |
| `ticket-casting` | **회차별 캐스팅** — KOPIS에 없는 정보 | 중간 (예매처 DOM) |
| `x-events` | 커튼콜·팬사인·할인 등 이벤트 | 중간 (신디케이션이 막히면) |

②와 ③은 **Extract → Transform → Load** 로 나눈다. 수집 방식은 서로 완전히 다르지만
(예매처=브라우저 캡처, X=HTTP GET), **산출물을 `ExtractedBundle` 하나로 통일**하고
그 뒤는 둘 다 똑같이 `claude -p`로 판독한다.

```
                 Extract              Transform            Load
                 (사이트마다 다름)     (전부 동일)
② 예매처   2-1 discover + capture  →  2-2 claude -p  →  회차별 캐스팅
③ X        3-1 syndication/playwright → 3-2 claude -p  →  이벤트
                     ↓                        ↓
              ExtractedBundle          zod 검증된 JSON
```

```ts
// shared/etl.ts — Extract 단계의 공통 산출물
interface ExtractedBundle {
  source: "interpark" | "yes24" | "melon" | "x";
  sourceId: string;      // 중복 방지 키 (X=status ID, 예매처=공연ID/URL)
  url: string;
  fetchedAt: string;
  postedAt: string | null;
  text: string;          // 텍스트로 확보된 내용
  imagePaths: string[];  // 로컬 이미지 — Transform이 Read 툴로 읽는다
  imageUrls: string[];
  meta: Record<string, string>;
}
```

이렇게 두는 이유:

- **Transform이 출처를 모른다.** 예매처가 하나 늘어도 판독 코드는 손대지 않는다.
- **수집과 판독을 따로 돌릴 수 있다.** 캡처를 `fixtures/`에 넣어두면 사이트에 접속하지 않고
  프롬프트만 반복해서 고칠 수 있다. 사이트에 부담도 안 준다.
- **중복 제외 지점이 한 곳이다.** `sourceId`만 보면 된다.

- `extract.ts` — 네트워크·DOM에 의존하는 부분을 전부 여기 몰아 넣는다. 제일 잘 깨지는 파일.
- `transform.ts` — `claude -p`로 판독. 프롬프트가 사는 곳. 입력은 `ExtractedBundle` 뿐.
- `schema.ts` — zod 스키마 + 형식 검증. AI가 형식을 어겨도 DB로 새어 나가지 않게 막는 마지막 관문.

### 배치 구성 — 하루 1회, 시간차 분산

| 시각 | 명령 | 비고 |
|---|---|---|
| 04:00 | `npm run collect -- --job=kopis` | 공식 API, 부담 없음 |
| 05:00 | `npm run collect -- --job=casting` | 추적 공연만. 공연당 3초 이상 간격 |
| 06:00 | `npm run collect -- --job=x` | 계정당 3초 이상 간격. 크롤링과 판독을 한 job에서 끝낸다 |

Windows **작업 스케줄러**에 3개 등록.

### 실행 흐름

```
1. sns_accounts에서 enabled=true 계정 로드
2. 계정별로:
   a. Playwright 비로그인 접속 (headless)
   b. article 6개에서 status ID / 이미지 URL / 텍스트 추출
   c. last_seen_id 이후 새 게시물만 필터
   d. 이미지 name=small → name=large 로 치환해 다운로드
   e. Supabase Storage에 원본 업로드, sns_posts INSERT
   f. 3초 이상 대기
3. 새 게시물 이미지 → `claude -p` 분석 → zod 검증 → events INSERT
4. last_seen_id / last_run_at 갱신
```

### 지켜야 할 것

- 순차 처리 (동시 요청 금지), 요청 간 3초 이상
- 이미 본 게시물 재요청 금지 (`last_seen_id`)
- 실패 시 즉시 재시도 금지 — 다음 배치로 미룸
- 셀렉터가 깨지면 조용히 빈 결과를 저장하지 말고 **에러 로그 남기고 중단** (X는 DOM 구조를 자주 바꿈)

---

## 6. 비용

| 항목 | 비용 |
|---|---|
| GitHub Pages | 무료 |
| Supabase | 무료 티어 (500MB DB, 1GB Storage) — 개인 용도로 충분 |
| 집 PC | 전기료만 |
| **AI 추출 (`claude -p`)** | **추가 비용 없음** — 기존 Claude Code 구독 사용량에 포함 |

개발 중에는 Anthropic API를 쓰지 않으므로 **이 프로젝트에 별도로 나가는 돈은 없다.**
다만 구독에는 사용량 한도가 있으므로, 이미지 분석은 게시물당 1회로 제한하고 이미 처리한 게시물은
재분석하지 않는다(`sns_posts.id` = X status ID로 중복 차단).
계정 20개 × 새 게시물 하루 2~3개 = 하루 40~60건 수준을 상한으로 본다.

무인 배치로 상시 운영하게 되면 그때 Anthropic API(사용량 과금)로 전환한다 (→ §2 ④).

---

## 7. 단계별 실행 계획

### 1단계 — 기반
- [x] `backend/` 패키지 생성, 모듈 3개 골격 + 테스트 하네스
- [x] `shared/claude.ts` — `runClaudeJson()` (`claude -p` 래퍼, zod 사후 검증 + 1회 재시도)
- [x] ~~Anthropic API 키 발급~~ → 불필요. `claude -p`로 대체 (→ §2 ④)
- [ ] **KOPIS 인증키 발급** (PC에서만, 메일로 수령) — 지금 가장 앞을 막고 있는 항목
- [ ] Supabase 프로젝트 생성 → 위 SQL로 스키마 생성 → RLS 설정
- [ ] Supabase Auth로 본인 계정 1개 생성

### 1.5단계 — 모듈별 실측 (키 발급 직후)
- [ ] `kopis`: `KOPIS_API_KEY=... npm test` → 응답 필드명이 PDF와 맞는지 대조 **(1순위)**
- [ ] `ticket-casting`: 캐스팅표 캡처를 `fixtures/`에 넣고 `RUN_LIVE=1 npm test` → 판독 정확도 확인
- [ ] `ticket-casting`: `HEADFUL=1`로 예매처 상세페이지를 띄워 `SITES` 셀렉터 확정
- [ ] `x-events`: `HEADFUL=1`로 X 프로필을 띄워 `TEXT_SELECTORS` 확정

### 2단계 — 데이터 계층 이식
- [ ] `queries.ts` → `supabase-js` 기반으로 재작성
- [ ] KOPIS 동기화를 수집기 스크립트로 이동
- [ ] **KOPIS 실호출 검증** (아직 미검증 — 응답 필드명이 개발가이드 PDF 기준이라 실제와 대조 필요)

### 3단계 — 앱 정적화 + 배포
- [ ] `next.config.ts`에 `output: 'export'`
- [ ] 페이지를 클라이언트 컴포넌트 + Supabase 조회로 전환
- [ ] GitHub Actions로 Pages 자동 배포
- [ ] 폰에서 접속 확인

### 4단계 — 수집기 완성
- [x] `backend/` 의존성 설치 (playwright, zod, fast-xml-parser)
- [ ] `npx playwright install chromium`
- [ ] `cli.ts`의 casting / x job 구현 (지금은 의도적으로 throw)
- [ ] 저장 계층 연결 — 수집 결과를 DB에 INSERT
- [ ] Windows 작업 스케줄러 등록 (3개 배치)

### 5단계 — 운영
- [ ] 추적 계정 목록 등록 (사용자 제공 예정)
- [ ] 수집 실패 알림 (실패 시 로그 파일 또는 본인에게 메일)
- [ ] 셀렉터 깨짐 대응 절차 마련

---

## 8. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| **X DOM 구조 변경** | 수집 중단 | 셀렉터 깨지면 에러로 중단·알림. 조용한 빈 저장 금지 |
| **X가 집 IP 차단** | 수집 불가 | 빈도 축소, 간격 확대. 최악의 경우 수동 캡처 업로드로 폴백 |
| **예매처 봇 차단** | 캐스팅 수집 불가 | 티켓링크는 이미 제외. 다른 곳도 경고 뜨면 즉시 제외 |
| **AI 추출 오류** | 잘못된 캐스팅 정보 | `confidence`/`verified` 컬럼 활용, 앱에서 미검증 표시 |
| **회차가 실제와 다름** | 헛걸음 | KOPIS 요일 패턴 기반 "예상 회차"임을 UI에 명시. 예매 전 예매처 확인 안내 |
| **GitHub Pages 공개 노출** | 개인 일정 유출 | Supabase Auth + RLS 필수 (선택 아님) |

---

## 9. 미해결 / 다음에 확인할 것

1. **KOPIS 실제 API 응답 검증** — 인증키 발급 후 첫 호출로 필드명 대조 (현재는 PDF 문서 기준으로만 작성됨)
2. ~~**X 본문 텍스트 셀렉터**~~ → **해결**. 신디케이션 엔드포인트가 `full_text`를 그대로 준다 (→ §2 ③).
   대신 새로 볼 것: 신디케이션의 **캐시 지연폭**(실측 4일)과 엔드포인트가 막힐 가능성
3. **추적할 X 계정 목록** — 사용자 제공 대기 중
4. ~~**회차별 캐스팅을 어디서 얻을 것인가**~~ → **해결하고 구현·저장까지 완료** (→ §2 ②, §5).
5. ~~**KOPIS 인증키 발급**~~ → **KOPIS 자체를 포기하고 우회**했다 (아래 §10).
6. **멜론티켓 미조사** — 사용자 지정 목록에 없었다.
7. **신디케이션 캐시 지연** — `@elonmusk` 기준 최신 게시물이 4일 전이었다.
   하루 1회 수집엔 지장 없지만 운영 전에 지연폭을 다시 재야 한다.
8. **NOL 발견의 페이지네이션** — 장르 목록 1페이지(뮤지컬 76건·연극 61건, 2026-09-07 실측)만 쓴다.
   "더보기" 시 호출되는 별도 API를 못 찾았다. 지금 커버리지로 부족하면 재조사한다.
9. **X 이벤트 ↔ 공연 자동 매칭이 약하다** — `events.show_id`는 게시물의 `showName`과
   `shows.name`의 단순 부분일치로 채운다 (`x-events/load.ts`). 오탐/누락 가능성이 있다.

---

## 10. KOPIS 포기 — 예매처 발견 방식으로 전환 (2026-09-07)

§9의 5번(KOPIS 인증키 발급 차단)이 KOPIS 쪽 인프라 장애로 확인된 뒤, **KOPIS 복구를 기다리지 않고
예매처 3사의 장르별 목록을 발견(discovery) 축으로 완전히 대체**했다. 판단 근거:

- 콘서트 등 비대상 장르는 URL 자체가 갈려 있어(`/ticket/genre/musical` vs `/ticket/genre/concert`)
  **연극·뮤지컬만 자동으로 걸러진다** — 별도 필터링 로직이 필요 없다.
- NOL은 목록도, 회차별 캐스팅도 전부 구조화 JSON이라 KOPIS보다 오히려 데이터 품질이 높다
  (KOPIS는 애초에 회차별 캐스팅을 준 적이 없다).
- 커버리지는 KOPIS(정부 통합 DB)보다 좁다 — NOL·예스24·티켓링크가 취급하지 않는 공연은 안 보인다.
  이 프로젝트 목적(챙겨보는 특정 공연 추적)에는 이 한계가 실질적 문제가 되지 않는다고 판단했다.

### 새 발견 경로 — NOL 장르 목록

```
GET https://nol.yanolja.com/ticket/genre/musical   (또는 /play)
```

순수 SSR HTML, 브라우저 불필요. Next.js가 페이지 안에 `self.__next_f.push([1,"..."])` 조각으로
React Query의 dehydrated state를 심어 두는데, 그 안에 위젯 데이터가 그대로 들어 있다.
항목마다 `"id":"{goodsCode}:{placeCode}"`(캐스팅 API에 바로 쓸 `goodsKey` 그 자체), `title`,
`dateInfo`, `locationDetails`가 있다.

**실측(2026-09-07): 뮤지컬 76건, 연극 61건, 1페이지 GET만으로.** 페이지네이션 API는 못 찾아서
지금은 1페이지 분량(위젯 다수 합산)만 쓴다 — §9-8.

### 파이프라인 종단 실증

`discover` → `casting` → (X는 별도) 를 실제로 끝까지 돌렸다:

| 단계 | 결과 |
|---|---|
| `discover` | shows **140건** 등록 (NOL 뮤지컬 76 + 연극 61, 예스24 시드 1, 티켓링크 시드 2) |
| `casting` (NOL 표본 3건) | 웨스턴 스토리 회차 69건·캐스팅 483건·배역 7개 / 등 — **구조화 API라 즉시 저장, AI 미사용** |
| `casting` (예스24 1건) | 곤 투모로우 회차 52건·캐스팅 260건·배역 5개 — `claude -p` 판독, 95초 소요 |

전량(140건)을 다 돌리면 예의상 간격(요청당 3초)만으로 15분 이상 걸린다. 실제 배치는 이 페이스대로
동작하는 게 맞고(사이트에 부담을 주지 않는 설계), 검증은 표본으로 충분히 확인했다.
5. **`claude -p` 구조화 출력 신뢰성** — SDK와 달리 스키마 준수가 보장되지 않는다. 실제 캐스팅표 캡처
   여러 장으로 파싱 실패율을 재보고, 허용 못 할 수준이면 API 전환을 앞당긴다
