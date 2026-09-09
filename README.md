# PICKTER

관심사 기반 뉴스 큐레이션 앱 (포트폴리오용).

- **모드 1 (기본)**: 큐레이션된 홈 화면 — 하드코딩 데이터, 네트워크 불필요
- **모드 2 (실시간)**: 우측 하단 FAB → 관심사 선택 → 선택한 카테고리의 실시간 뉴스 로드

## 스택

- 프론트: 단일 `index.html` (인라인 CSS/JS, 프레임워크 없음)
- 백엔드: Vercel 서버리스 함수 `api/news.js`
- 뉴스 소스: **구글 뉴스 RSS**(서버-to-서버 직접 호출) — **네이버 검색 API**는 연동해두었으나 신규 개발자 등록이 막혀 있어 현재는 미사용. 키가 생기면 `.env.local`에 넣기만 하면 자동으로 1순위로 전환됨
- 호스팅: Vercel (정적 + 서버리스, 빌드 스텝 없음)

## 실시간 뉴스가 동작하는 방식

기존 버전은 브라우저에서 구글 뉴스 RSS를 공용 CORS 프록시(`api.allorigins.win`)로
직접 불러왔고, 프록시가 구글에 의해 봇 차단되면서 "뉴스를 불러오지 못했어요"가 자주 떴다.

현재 구조:

```
브라우저 ──/api/news?q=경제──▶ Vercel 함수 ──▶ 네이버 검색 API (환경변수 있을 때만 시도)
                                          └─(키 없음/실패 시)─▶ 구글 뉴스 RSS (서버-to-서버 직접 호출)
                              ◀── JSON { items: [...] } ──┘
```

- 브라우저는 항상 same-origin `/api/news` 만 호출 → **CORS 자체가 없음**
- 네이버 API는 신규 개발자 등록이 막혀있어(2026.08 기준) 현재 `NAVER_CLIENT_ID`/`SECRET` 미설정 상태 → 항상 구글 경로 사용. 코드/문서는 그대로 두었으니 나중에 등록이 풀리면 `.env.local`에 키만 넣으면 즉시 전환됨
- 함수 응답은 키워드별 10분 엣지 캐시(`s-maxage=600`) → 상류 호출량 최소화, 구글 봇 차단 위험도 낮춤

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # 네이버 키 입력 (없으면 구글 RSS 폴백으로 동작)
npm run dev                  # vercel dev → http://localhost:3000
```

## 네이버 검색 API 키 발급

1. https://developers.naver.com/apps/#/register 접속
2. 애플리케이션 이름 입력, **사용 API = "검색"** 선택
3. 환경 추가에서 **WEB 설정** → 서비스 URL 에 배포 도메인(또는 `http://localhost:3000`) 입력
4. 등록 후 발급되는 **Client ID / Client Secret** 을 `.env.local` (로컬) 및
   Vercel → Settings → Environment Variables (배포) 에 입력

무료 한도: 하루 25,000회.

## 배포 (Vercel)

```bash
npm i -g vercel      # 또는 npx vercel
vercel login
vercel --prod
```

배포 후 Vercel 프로젝트 설정에서 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 환경변수 등록.
