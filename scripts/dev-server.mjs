/**
 * 로그인 없이 로컬에서 index.html + /api/news 를 함께 띄우는 최소 개발 서버.
 * (Vercel 계정 없이 검증용. 실제 배포 환경과 동일하게 돌리려면 `npm run dev` = vercel dev)
 *
 *   node scripts/dev-server.mjs      → http://localhost:3000
 *   .env.local 이 있으면 자동 로드 (NAVER_CLIENT_ID / NAVER_CLIENT_SECRET)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = process.cwd();
const PORT = process.env.PORT || 3000;

// .env.local 간단 파서
if (existsSync(join(ROOT, ".env.local"))) {
  const raw = await readFile(join(ROOT, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
};

const newsHandler = (await import("../api/news.js")).default;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/news") {
    const shim = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader: (k, v) => res.setHeader(k, v),
      json(obj) { res.writeHead(this.statusCode, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); },
    };
    try {
      await newsHandler({ query: Object.fromEntries(url.searchParams) }, shim);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: [], error: String(e) }));
    }
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
    res.writeHead(404); res.end("Not found"); return;
  }
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(500); res.end("Server error");
  }
}).listen(PORT, () => console.log(`▶ http://localhost:${PORT}  (news source: ${process.env.NAVER_CLIENT_ID ? "naver" : "google fallback"})`));
