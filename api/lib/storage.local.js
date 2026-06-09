const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "../../data/plans");

async function ensureRoot() {
  await fs.mkdir(root, { recursive: true });
}

function planPath(planId) {
  return path.join(root, `${safeId(planId)}.json`);
}

function safeId(value) {
  return String(value || "demo").replace(/[^a-zA-Z0-9_-]/g, "");
}

async function readPlan(planId) {
  await ensureRoot();
  try {
    const text = await fs.readFile(planPath(planId), "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writePlan(planId, plan) {
  await ensureRoot();
  const next = {
    ...plan,
    id: safeId(planId),
    savedAt: new Date().toISOString()
  };
  await fs.writeFile(planPath(planId), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { readPlan, writePlan };
