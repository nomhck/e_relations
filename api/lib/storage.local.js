const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "../../data/plans");

// Ensure the local data directory exists before reading or writing plan files.
async function ensureRoot() {
  await fs.mkdir(root, { recursive: true });
}

// Resolve the JSON file path for a plan id.
function planPath(planId) {
  return path.join(root, `${safeId(planId)}.json`);
}

// Keep plan ids filesystem-safe so request paths cannot escape data/plans.
function safeId(value) {
  return String(value || "demo").replace(/[^a-zA-Z0-9_-]/g, "");
}

// Read a plan from local JSON storage. Missing files are treated as "not found".
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

// Write a full plan snapshot to local JSON storage and stamp the save time.
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
