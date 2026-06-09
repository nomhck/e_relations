const { readPlan, writePlan } = require("../lib/storage.local");

// Route plan API requests. The same handler is used by the local server and can be adapted to Functions.
async function handlePlans(req, res, params) {
  // Return an existing plan from local JSON storage.
  if (req.method === "GET") {
    const plan = await readPlan(params.id);
    if (!plan) return json(res, 404, { error: "not found" });
    return json(res, 200, { plan });
  }

  // Replace an existing plan with the client-supplied state.
  if (req.method === "PUT") {
    const body = await readJson(req);
    if (!body.plan) return json(res, 400, { error: "plan is required" });
    const plan = await writePlan(params.id, body.plan);
    return json(res, 200, { plan });
  }

  // Create a new plan. This is not used heavily yet, but keeps the API shape ready.
  if (req.method === "POST") {
    const body = await readJson(req).catch(() => ({}));
    const id = body.id || `plan_${Date.now()}`;
    const plan = await writePlan(id, body.plan || { id, name: body.name || "New EPC Plan", tasks: [], dependencies: [] });
    return json(res, 201, { plan });
  }

  return json(res, 405, { error: "method not allowed" });
}

// Read and parse the JSON request body from a Node HTTP stream.
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

// Send a JSON response with a status code.
function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

module.exports = { handlePlans, json };
