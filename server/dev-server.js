const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { handlePlans, json } = require("../api/handlers/plans");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const webRoot = path.resolve(__dirname, "../web");

// Local development server: serves static web files and a tiny JSON API on one port.
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Create a new plan through the local API.
    if (url.pathname === "/api/plans" && req.method === "POST") {
      return handlePlans(req, res, {});
    }

    // Read or save an existing plan by id.
    const planMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
    if (planMatch) {
      return handlePlans(req, res, { id: planMatch[1] });
    }

    // Everything else is treated as a static frontend request.
    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "internal server error" });
  }
});

// Bind to loopback by default so the MVP server is not exposed on the LAN.
server.listen(port, host, () => {
  console.log(`E Relations local server`);
  console.log(`http://${host}:${port}`);
});

// Serve a static file. Unknown paths fall back to index.html for client-side routing.
async function serveStatic(pathname, res) {
  const filePath = resolveStaticPath(pathname);
  const data = await fs.readFile(filePath).catch(async (error) => {
    if (error.code !== "ENOENT") throw error;
    return fs.readFile(path.join(webRoot, "index.html"));
  });

  res.writeHead(200, { "Content-Type": contentType(filePath) });
  res.end(data);
}

// Resolve requested paths inside webRoot and block path traversal.
function resolveStaticPath(pathname) {
  const clean = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(webRoot, `.${clean}`);
  if (!resolved.startsWith(webRoot)) return path.join(webRoot, "index.html");
  return resolved;
}

// Minimal content-type mapping for the files this MVP serves.
function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}
