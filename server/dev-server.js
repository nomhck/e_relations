const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { handlePlans, json } = require("../api/handlers/plans");

const port = Number(process.env.PORT || 3000);
const webRoot = path.resolve(__dirname, "../web");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/plans" && req.method === "POST") {
      return handlePlans(req, res, {});
    }

    const planMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
    if (planMatch) {
      return handlePlans(req, res, { id: planMatch[1] });
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "internal server error" });
  }
});

server.listen(port, () => {
  console.log(`E Relations local server`);
  console.log(`http://localhost:${port}`);
});

async function serveStatic(pathname, res) {
  const filePath = resolveStaticPath(pathname);
  const data = await fs.readFile(filePath).catch(async (error) => {
    if (error.code !== "ENOENT") throw error;
    return fs.readFile(path.join(webRoot, "index.html"));
  });

  res.writeHead(200, { "Content-Type": contentType(filePath) });
  res.end(data);
}

function resolveStaticPath(pathname) {
  const clean = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(webRoot, `.${clean}`);
  if (!resolved.startsWith(webRoot)) return path.join(webRoot, "index.html");
  return resolved;
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}
