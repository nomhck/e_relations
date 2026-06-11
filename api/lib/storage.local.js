const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "../../data/plans");

// プランファイルを読み書きする前に、ローカル保存ディレクトリを作成します。
async function ensureRoot() {
  await fs.mkdir(root, { recursive: true });
}

// プランIDに対応するJSONファイルの保存パスを作ります。
function planPath(planId) {
  return path.join(root, `${safeId(planId)}.json`);
}

// プランIDを安全な文字だけにし、data/plans外へ抜けるパスを作れないようにします。
function safeId(value) {
  return String(value || "demo").replace(/[^a-zA-Z0-9_-]/g, "");
}

// ローカルJSON保存からプランを読み込みます。ファイルがなければ未作成として扱います。
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

// プラン全体のスナップショットをJSONへ保存し、保存時刻も付与します。
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
