const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { handlePlans, json } = require("../api/handlers/plans");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const webRoot = path.resolve(__dirname, "../web");

// ローカル開発サーバーです。静的フロントエンドと小さなJSON APIを同じポートで配信します。
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // ローカルAPI経由で新しい工程プランを作成します。
    if (url.pathname === "/api/plans" && req.method === "POST") {
      return handlePlans(req, res, {});
    }

    // URL上のIDを使って既存プランを読み込み、または保存します。
    const planMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
    if (planMatch) {
      return handlePlans(req, res, { id: planMatch[1] });
    }

    // それ以外のリクエストは、フロントエンド静的ファイルとして扱います。
    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "internal server error" });
  }
});

// 初期状態ではlocalhostだけで待ち受け、LANへ不用意に公開しないようにします。
server.listen(port, host, () => {
  console.log(`E Relations local server`);
  console.log(`http://${host}:${port}`);
});

// 静的ファイルを返します。不明なパスはクライアント側ルーティング用にindex.htmlへ戻します。
async function serveStatic(pathname, res) {
  const filePath = resolveStaticPath(pathname);
  const data = await fs.readFile(filePath).catch(async (error) => {
    if (error.code !== "ENOENT") throw error;
    return fs.readFile(path.join(webRoot, "index.html"));
  });

  res.writeHead(200, { "Content-Type": contentType(filePath) });
  res.end(data);
}

// 要求パスをwebRoot内に解決し、ディレクトリ外へ抜けるアクセスを防ぎます。
function resolveStaticPath(pathname) {
  const clean = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(webRoot, `.${clean}`);
  if (!resolved.startsWith(webRoot)) return path.join(webRoot, "index.html");
  return resolved;
}

// このMVPで配信するファイルに必要な最小限のContent-Type対応です。
function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}
