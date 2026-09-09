/**
 * GET /api/news?q=<카테고리 또는 키워드>
 *
 * 브라우저가 아니라 이 서버리스 함수가 뉴스를 대신 호출한다.
 *  1순위: 네이버 검색 API(정식 API, 안정적)  ─ NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 필요
 *  폴백 : 구글 뉴스 RSS를 서버-to-서버로 직접 호출(공유 CORS 프록시 없음)
 *
 * 응답: { items: [ { t, tag, tags, time, g, seed, link, source, desc } ], source: "naver"|"google"|"none" }
 * items 형태는 index.html의 하드코딩 배열(HERO/TODAY_PICK/HOT_PICK)과 동일 → 렌더 함수 수정 불필요.
 * desc(발췌문)는 네이버만 제공한다 - 구글 뉴스 RSS의 <description>은 관련기사 목록 HTML이라 신뢰할 수 없어 비워둔다.
 */

const G_CLASSES = ["g-econ", "g-life", "g-ai", "g-mix1", "g-mix2", "g-mix3"];
const UPSTREAM_TIMEOUT_MS = 6000;
const PER_KEYWORD_LIMIT = 8;

function randomG() {
  return G_CLASSES[Math.floor(Math.random() * G_CLASSES.length)];
}

function slugify(s) {
  return (s || "news").replace(/[^a-zA-Z0-9가-힣]/g, "").slice(0, 20) || "news";
}

/** <b> 태그 제거 + HTML 엔티티 디코드 (네이버/구글 제목 모두 대상) */
function decodeText(s) {
  return String(s || "")
    .replace(/<\/?b>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** " - 언론사" 꼬리표 제거 (구글 뉴스 RSS 제목 형식) */
function stripSourceSuffix(title, source) {
  if (source && title.endsWith(" - " + source)) return title.slice(0, -(source.length + 3));
  return title.replace(/ - [^-]{2,30}$/, "");
}

function relativeTime(pubDateStr) {
  const d = new Date(pubDateStr);
  if (isNaN(d.getTime())) return "";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  return `${Math.floor(diffH / 24)}일 전`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function toItem(keyword, title, pubDate, link, source, desc) {
  const t = decodeText(title).replace(/^[\s■◆●▶◼️▪️※□▷▶️]+/, "").trim();
  const cleanDesc = desc
    ? decodeText(String(desc).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 300)
    : "";
  return {
    t,
    tag: `관심:${keyword}`,
    tags: [`관심:${keyword}`],
    time: relativeTime(pubDate),
    g: randomG(),
    seed: slugify(t),
    link: /^https?:\/\//.test(link) ? link : "",
    source: source || hostOf(link),
    desc: cleanDesc,
  };
}

/* ---------------- 1순위: 네이버 검색 API ---------------- */
async function fromNaver(keyword) {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null; // 자격증명 없음 → 폴백으로

  const url =
    "https://openapi.naver.com/v1/search/news.json?display=" +
    PER_KEYWORD_LIMIT +
    "&sort=date&query=" +
    encodeURIComponent(keyword);

  const res = await fetchWithTimeout(url, {
    headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
  });
  if (!res.ok) throw new Error("naver " + res.status);

  const data = await res.json();
  const items = (data.items || [])
    .map((it) => toItem(keyword, it.title, it.pubDate, it.originallink || it.link, hostOf(it.originallink || it.link), it.description))
    .filter((it) => it.t);
  return items.length ? items : null;
}

/* ---------------- 폴백: 구글 뉴스 RSS (서버에서 직접) ---------------- */
async function fromGoogle(keyword) {
  const url =
    "https://news.google.com/rss/search?hl=ko&gl=KR&ceid=KR:ko&q=" +
    encodeURIComponent(keyword);

  const res = await fetchWithTimeout(url, {
    headers: {
      // 봇 차단 페이지 대신 정상 RSS를 받기 위한 일반 브라우저 UA
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
  });
  if (!res.ok) throw new Error("google " + res.status);

  const xml = await res.text();
  if (!/<item>/.test(xml)) throw new Error("google: no items (bot page?)");

  const items = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const block of blocks.slice(0, PER_KEYWORD_LIMIT)) {
    const pick = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      if (!m) return "";
      return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
    };
    const source = pick("source");
    const rawTitle = pick("title");
    const title = stripSourceSuffix(decodeText(rawTitle), source);
    if (!title) continue;
    items.push(toItem(keyword, title, pick("pubDate"), pick("link"), source));
  }
  return items.length ? items : null;
}

export default async function handler(req, res) {
  const q = String((req.query && req.query.q) || "").trim() || "속보";

  let items = null;
  let source = "none";
  const errors = [];

  try {
    items = await fromNaver(q);
    if (items) source = "naver";
  } catch (e) {
    errors.push("naver: " + e.message);
  }

  if (!items) {
    try {
      items = await fromGoogle(q);
      if (items) source = "google";
    } catch (e) {
      errors.push("google: " + e.message);
    }
  }

  // 엣지 캐시: 키워드별 10분 캐시 + 30분 stale-while-revalidate
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");

  if (!items) {
    return res.status(502).json({ items: [], source, error: errors.join(" | ") || "upstream failed" });
  }
  return res.status(200).json({ items, source });
}
