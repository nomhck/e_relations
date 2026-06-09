const { readPlan, writePlan } = require("../lib/storage.local");

async function handlePlans(req, res, params) {
  if (req.method === "GET") {
    const plan = await readPlan(params.id);
    if (!plan) return json(res, 404, { error: "not found" });
    return json(res, 200, { plan });
  }

  if (req.method === "PUT") {
    const body = await readJson(req);
    if (!body.plan) return json(res, 400, { error: "plan is required" });
    const plan = await writePlan(params.id, body.plan);
    return json(res, 200, { plan });
  }

  if (req.method === "POST") {
    const body = await readJson(req).catch(() => ({}));
    const id = body.id || `plan_${Date.now()}`;
    const plan = await writePlan(id, body.plan || { id, name: body.name || "New EPC Plan", tasks: [], dependencies: [] });
    return json(res, 201, { plan });
  }

  return json(res, 405, { error: "method not allowed" });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

module.exports = { handlePlans, json };
