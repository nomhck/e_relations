# e_relations Azure Lightweight Implementation Plan

## 方針

Azure依存を最小化し、工程管理ロジックは自前実装する。

- Azure Static Web Apps: 画面配信
- Managed Azure Functions: API 3本
- Azure Blob Storage: 工程JSON保存
- 認証: 共有編集キー方式
- DB / Cosmos DB / SQL / Entra ID / Key Vault / Data API Builder は初期版では使わない

## 機能要件の採用方針

詳細は [functional-requirements.md](functional-requirements.md) にまとめる。
添付仕様のRelation Tool v2.1から、工程管理に直接効く機能を優先して採用する。

初期版で必須にする機能:

- タスクの追加、編集、ドラッグ配置
- FS / SS / FF / SF とラグ付き依存線
- 自己依存、重複依存、循環依存の防止
- CPM計算、クリティカル、余裕日数の表示
- ネットワーク図、ガント、表ビュー
- 領域フィルター、検索、フォーカス一覧
- localStorage、ローカルJSON、Azure Blob Storageへの保存

次段階に回す機能:

- タスクの説明、ステータス、予定日、実績日、レベル
- 所属マスター、所属色、所属ゾーン
- 依存線ラベル、CSV import/export、変更履歴
- ボトルネック、中心性、世代、連結成分などの分析
- サブグラフ、断面ビュー、3Dビュー

## 構成図

```mermaid
flowchart LR
  U[User Browser] --> SWA[Azure Static Web Apps]
  SWA --> WEB[Static Frontend<br/>HTML CSS JS]
  WEB --> API[Managed Azure Functions]
  API --> AUTH[Edit Key Check<br/>SHA-256 Hash]
  API --> VAL[Plan Validation<br/>Cycle Check / Schema Check]
  API --> BLOB[Azure Blob Storage<br/>plans/{planId}.json]

  WEB --> CPM[Client-side CPM<br/>Critical Path / Float]
  WEB --> GRAPH[Client-side UI<br/>Graph / Gantt / Table]
```

## URL設計

```txt
閲覧URL:
https://example.azurestaticapps.net/p/{planId}

編集URL:
https://example.azurestaticapps.net/p/{planId}?edit={editKey}
```

`editKey` はサーバー側でハッシュ化して保存する。生の編集キーは保存しない。

## API

```txt
POST /api/plans
GET  /api/plans/{id}
PUT  /api/plans/{id}
```

## 保存形式

Blob Storage:

```txt
plans/{planId}.json
```

JSON:

```json
{
  "id": "plan_abc123",
  "name": "EPC Sample Plan",
  "editKeyHash": "sha256-hash",
  "version": 1,
  "tasks": [
    {
      "id": "t1",
      "code": "E100",
      "name": "PFD確定",
      "area": "Engineering",
      "owner": "Process Lead",
      "duration": 8,
      "progress": 0,
      "x": 40,
      "y": 78
    },
    {
      "id": "t2",
      "code": "E110",
      "name": "P&ID Rev.B発行",
      "area": "Engineering",
      "owner": "Process Lead",
      "duration": 14,
      "progress": 0,
      "x": 285,
      "y": 72
    }
  ],
  "dependencies": [
    {
      "id": "d1",
      "from": "t1",
      "to": "t2",
      "type": "FS",
      "lag": 0
    }
  ],
  "updatedAt": "2026-06-09T00:00:00.000Z"
}
```

## ファイル構成

```txt
e_relations/
  web/
    index.html
    styles.css
    app.js
    api.js
    schedule.js
    types.js

  api/
    package.json
    host.json
    src/
      functions/
        createPlan.js
        getPlan.js
        savePlan.js
      lib/
        storage.js
        auth.js
        validate.js
```

## Frontend: api.js

```js
export async function createPlan(name) {
  const res = await fetch("/api/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function loadPlan(planId) {
  const res = await fetch(`/api/plans/${planId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function savePlan(planId, plan, editKey, etag) {
  const res = await fetch(`/api/plans/${planId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, editKey, etag })
  });

  if (res.status === 409) {
    throw new Error("他のユーザーが先に保存しています。再読み込みしてください。");
  }

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

## Frontend: schedule.js

```js
export function hasCycle(tasks, dependencies) {
  const ids = new Set(tasks.map((task) => task.id));
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  const outgoing = new Map(tasks.map((task) => [task.id, []]));

  for (const dep of dependencies) {
    if (!ids.has(dep.from) || !ids.has(dep.to)) continue;
    outgoing.get(dep.from).push(dep.to);
    indegree.set(dep.to, indegree.get(dep.to) + 1);
  }

  const queue = tasks
    .filter((task) => indegree.get(task.id) === 0)
    .map((task) => task.id);

  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;

    for (const next of outgoing.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  return visited !== tasks.length;
}

export function calculateSchedule(tasks, dependencies) {
  // MVPではフロントでCPM計算する。
  // API側は保存前の最低限検証だけ行う。
  return {
    projectDurationDays: 0,
    tasks: new Map()
  };
}
```

## API: package.json

```json
{
  "name": "e-relations-api",
  "version": "0.1.0",
  "type": "commonjs",
  "dependencies": {
    "@azure/functions": "^4.0.0",
    "@azure/storage-blob": "^12.0.0"
  },
  "devDependencies": {
    "azure-functions-core-tools": "^4.0.0"
  }
}
```

## API: host.json

```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true
      }
    }
  }
}
```

## API: lib/storage.js

```js
const { BlobServiceClient } = require("@azure/storage-blob");

const service = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);

const container = service.getContainerClient("plans");

function blobName(planId) {
  return `${planId}.json`;
}

async function ensureContainer() {
  await container.createIfNotExists();
}

async function readPlan(planId) {
  await ensureContainer();

  const blob = container.getBlockBlobClient(blobName(planId));
  const exists = await blob.exists();
  if (!exists) return null;

  const download = await blob.download();
  const text = await streamToText(download.readableStreamBody);

  return {
    plan: JSON.parse(text),
    etag: download.etag
  };
}

async function writePlan(planId, plan, etag) {
  await ensureContainer();

  const blob = container.getBlockBlobClient(blobName(planId));
  const body = JSON.stringify(plan, null, 2);

  await blob.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: "application/json" },
    conditions: etag ? { ifMatch: etag } : undefined
  });

  return readPlan(planId);
}

function streamToText(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

module.exports = { readPlan, writePlan };
```

## API: lib/auth.js

```js
const crypto = require("crypto");

function createEditKey() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashEditKey(editKey) {
  return crypto.createHash("sha256").update(editKey).digest("hex");
}

function assertCanEdit(plan, editKey) {
  if (!editKey) {
    const error = new Error("Missing edit key");
    error.status = 401;
    throw error;
  }

  if (hashEditKey(editKey) !== plan.editKeyHash) {
    const error = new Error("Invalid edit key");
    error.status = 403;
    throw error;
  }
}

module.exports = { createEditKey, hashEditKey, assertCanEdit };
```

## API: lib/validate.js

```js
function validatePlan(plan) {
  if (!plan || typeof plan !== "object") return "Invalid plan";
  if (!Array.isArray(plan.tasks)) return "tasks must be array";
  if (!Array.isArray(plan.dependencies)) return "dependencies must be array";

  const taskIds = new Set(plan.tasks.map((task) => task.id));
  for (const dep of plan.dependencies) {
    if (!taskIds.has(dep.from)) return `Unknown from: ${dep.from}`;
    if (!taskIds.has(dep.to)) return `Unknown to: ${dep.to}`;
    if (dep.from === dep.to) return "Self dependency is not allowed";
  }

  if (hasCycle(plan.tasks, plan.dependencies)) {
    return "Cyclic dependency is not allowed";
  }

  return null;
}

function hasCycle(tasks, dependencies) {
  const ids = new Set(tasks.map((task) => task.id));
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  const outgoing = new Map(tasks.map((task) => [task.id, []]));

  for (const dep of dependencies) {
    if (!ids.has(dep.from) || !ids.has(dep.to)) continue;
    outgoing.get(dep.from).push(dep.to);
    indegree.set(dep.to, indegree.get(dep.to) + 1);
  }

  const queue = tasks
    .filter((task) => indegree.get(task.id) === 0)
    .map((task) => task.id);

  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;

    for (const next of outgoing.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  return visited !== tasks.length;
}

module.exports = { validatePlan };
```

## API: functions/createPlan.js

```js
const { app } = require("@azure/functions");
const crypto = require("crypto");
const { writePlan } = require("../lib/storage");
const { createEditKey, hashEditKey } = require("../lib/auth");

app.http("createPlan", {
  methods: ["POST"],
  route: "plans",
  authLevel: "anonymous",
  handler: async (req) => {
    const body = await req.json().catch(() => ({}));
    const id = `plan_${crypto.randomUUID()}`;
    const editKey = createEditKey();

    const plan = {
      id,
      name: body.name || "New EPC Plan",
      editKeyHash: hashEditKey(editKey),
      version: 1,
      tasks: [],
      dependencies: [],
      updatedAt: new Date().toISOString()
    };

    const saved = await writePlan(id, plan);

    return {
      status: 201,
      jsonBody: {
        plan: saved.plan,
        etag: saved.etag,
        editKey,
        viewUrl: `/p/${id}`,
        editUrl: `/p/${id}?edit=${encodeURIComponent(editKey)}`
      }
    };
  }
});
```

## API: functions/getPlan.js

```js
const { app } = require("@azure/functions");
const { readPlan } = require("../lib/storage");

app.http("getPlan", {
  methods: ["GET"],
  route: "plans/{id}",
  authLevel: "anonymous",
  handler: async (req) => {
    const result = await readPlan(req.params.id);
    if (!result) return { status: 404 };

    const { editKeyHash, ...safePlan } = result.plan;

    return {
      jsonBody: {
        plan: safePlan,
        etag: result.etag
      }
    };
  }
});
```

## API: functions/savePlan.js

```js
const { app } = require("@azure/functions");
const { readPlan, writePlan } = require("../lib/storage");
const { assertCanEdit } = require("../lib/auth");
const { validatePlan } = require("../lib/validate");

app.http("savePlan", {
  methods: ["PUT"],
  route: "plans/{id}",
  authLevel: "anonymous",
  handler: async (req) => {
    const id = req.params.id;
    const body = await req.json();

    const current = await readPlan(id);
    if (!current) return { status: 404 };

    assertCanEdit(current.plan, body.editKey);

    const nextPlan = {
      ...current.plan,
      name: body.plan.name || current.plan.name,
      tasks: body.plan.tasks,
      dependencies: body.plan.dependencies,
      version: current.plan.version + 1,
      updatedAt: new Date().toISOString()
    };

    const validationError = validatePlan(nextPlan);
    if (validationError) {
      return {
        status: 400,
        jsonBody: { error: validationError }
      };
    }

    try {
      const saved = await writePlan(id, nextPlan, body.etag);
      const { editKeyHash, ...safePlan } = saved.plan;

      return {
        jsonBody: {
          plan: safePlan,
          etag: saved.etag
        }
      };
    } catch (error) {
      if (error.statusCode === 412) {
        return {
          status: 409,
          jsonBody: {
            error: "Plan was updated by another user. Reload required."
          }
        };
      }

      throw error;
    }
  }
});
```

## 実装順

1. 静的UIを `web/` に置く
2. `POST /api/plans` で新規工程作成
3. `GET /api/plans/{id}` で読込
4. `PUT /api/plans/{id}` で保存
5. Blob ETagで409 conflictを出す
6. フロント側で依存関係チェックとCPM計算
7. 必要になったら履歴保存を追加

## 後から追加する候補

- `plans/{id}/history/{version}.json` に保存履歴
- 読み取り専用URLと編集URLの明確な分離
- タスクの説明、ステータス、予定日、実績日、レベル
- 所属マスター、所属色、所属ゾーン
- 依存線ラベル
- CSV import/export
- ボトルネック、中心性、世代、連結成分などの分析
- サブグラフ、断面ビュー、3Dビュー
- Entra ID認証
- Cosmos DB移行
- リアルタイム共同編集
