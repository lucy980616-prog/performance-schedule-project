# 공연 스케줄 (뮤킷 대체용 개인 서비스)

연극·뮤지컬 공연 일정과 **회차별 캐스팅**을 한곳에서 보는 개인용 웹앱.
서비스 종료된 [뮤킷](https://myukit.com)의 핵심 기능을 직접 쓰려고 다시 만든 것.

`web/`은 **읽기 전용 정적 앱**이다. 무거운 일(예매처/X 수집, AI 판독)은 전부 `backend/`가
집 PC에서 끝내고 Supabase에 저장하면, 이 앱은 브라우저에서 `supabase-js`로 그 결과를
직접 조회만 한다. GitHub Pages 같은 정적 호스팅에 그대로 올라간다.

전체 설계는 [`../docs/03-final-architecture-plan.md`](../docs/03-final-architecture-plan.md) 참고.

## 데이터 출처

- **공연 발견**: NOL(인터파크) 장르 목록 / 예스24·티켓링크 상세페이지 — `backend/`가 매일 수집
- **회차별 캐스팅**: NOL은 구조화 API 그대로, 예스24는 캐스팅표 이미지를 Claude가 판독
- **이벤트(커튼콜·팬사인 등)**: 제작사 X(트위터) 계정 게시물을 Claude가 판독

> KOPIS(공연예술통합전산망)는 인증키 발급 서비스 장애로 2026-09-07부로 잠정 제외했다.
> 자세한 경위는 `backend/README.md` 참고.

## 시작하기

### 1. Supabase 키 준비

```bash
cp .env.local.example .env.local
```

`.env.local`에 Supabase 프로젝트의 URL과 anon(publishable) 키를 채운다
(Supabase 대시보드 > Project Settings > API). 공개 데이터는 RLS로 익명 읽기만 허용되어
있어 이 키가 브라우저에 노출돼도 안전하다.

### 2. 실행

```bash
npm install
npm run dev      # http://localhost:3000
```

## 화면

| 경로 | 설명 |
|---|---|
| `/` | 오늘의 공연 — 날짜별 회차 + 그날 캐스팅 (애배는 빨갛게) |
| `/shows` | 전체 공연 목록, 상태/장르 필터 |
| `/shows/[id]` | 공연 상세 + **회차별 캐스팅 달력**(달력/목록 전환) |
| `/actors/[name]` | 배우별 출연 회차 |
| `/my/actors` | 애배 달력 |
| `/my/calendar` | 내 관람 일정 |

## 구조

```
src/
  lib/
    supabase.ts  supabase-js 클라이언트 (anon 키)
    data.ts      Supabase 조회/애배 등록 함수들. 페이지가 통째로 불러와 클라이언트에서 필터링한다
    utils.ts     cn, splitNames, todayISO
  app/
    page.tsx                 오늘의 공연 (client)
    shows/page.tsx            전체 공연 (client)
    shows/[id]/               공연 상세 — page.tsx(generateStaticParams) + show-detail-client.tsx
    actors/[name]/             배우 상세 — page.tsx(generateStaticParams) + actor-client.tsx
    my/actors, my/calendar    애배·내 달력 (client)
```

모든 페이지는 클라이언트 컴포넌트다. 정적 export(GitHub Pages)에는 서버가 없어
요청 시점 `searchParams`를 쓸 수 없기 때문에, 데이터는 브라우저가 뜬 뒤
`supabase-js`로 직접 가져오고 필터/정렬도 클라이언트에서 한다. `/shows/[id]`와
`/actors/[name]`처럼 라우트 세그먼트가 필요한 페이지만 `generateStaticParams`로
빌드 시점에 존재하는 id/배우 이름 목록을 훑어 정적 페이지 껍데기를 만들어 둔다 —
실제 내용은 여전히 브라우저에서 최신 데이터로 채워진다.

## 배포 — GitHub Pages

`.github/workflows/deploy-web.yml`이 `main` 브랜치의 `web/` 변경을 감지해
`next build`(→ `output: 'export'`) 후 GitHub Pages로 올린다. 저장소 시크릿에
`SUPABASE_URL` / `SUPABASE_ANON_KEY`가 필요하다(둘 다 공개해도 안전한 값 — anon 키는
RLS로 보호됨).

로컬에서 GitHub Pages와 동일한 빌드(하위 경로 `/performance-schedule-project/` 포함)를
확인하려면:

```bash
GITHUB_PAGES=1 npm run build
npx serve out   # 또는 원하는 정적 서버
```

## 알아둘 점

- **회차는 "예상"이 아니라 실측이다.** 예매처(특히 NOL)가 회차별 캐스팅을 구조화 데이터로
  주기 때문에, 이전 KOPIS 요일 패턴 추정 방식보다 정확도가 높다. 다만 예매처가 다루지 않는
  공연은 아예 안 보인다는 커버리지 한계가 있다.
- **개인 데이터(애배·내 달력)는 지금 로그인 없이 anon 키로 쓰기까지 허용한 프로토타입
  상태다.** 여러 사람이 같은 사이트를 보면 서로의 애배/일정이 섞인다. Supabase Auth를
  붙이기 전까지는 사실상 "나만 URL을 아는" 개인용으로만 써야 한다.
- 데이터는 전부 Supabase(Postgres)에 있다. `backend/`가 하루 배치로 채우고,
  이 앱은 읽기만 한다.
