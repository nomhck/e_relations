// 旧アップロード用の静的コピーです。現在の本体は web/ と docs/ を参照してください。
// このファイルは過去版の動作確認用として残しているため、主要ブロックだけ説明コメントを付けています。

// ブラウザ保存キー、ノードサイズ、ガント幅など、この旧UI全体で使う基本定数です。
const STORAGE_KEY = "epc-dependency-planner-v2";
const NODE_W = 196;
const NODE_H = 110;
const DAY_WIDTH = 18;

// EPC工程の初期マスターです。領域や職種の選択肢として使います。
const AREAS = [
  "Engineering",
  "Procurement",
  "Fabrication",
  "Construction",
  "Commissioning"
];

const DISCIPLINES = [
  "Process",
  "Mechanical",
  "Piping",
  "Civil",
  "E&I",
  "QA/QC",
  "Planning"
];

const RELATION_LABELS = {
  FS: "FS",
  SS: "SS",
  FF: "FF",
  SF: "SF"
};

// 画面状態、計算結果、ドラッグ操作中の一時情報を保持します。
let state = loadState();
let schedule = null;
let dragState = null;
let ganttDragState = null;
let ignoreNextClick = false;

// 初期化時にDOM要素をまとめて格納し、以後の処理で再利用します。
const els = {};

document.addEventListener("DOMContentLoaded", init);

// 初期化処理です。DOM参照、イベント登録、初回描画を順番に行います。
function init() {
  cacheElements();
  bindEvents();
  renderAll();
}

// 画面内で頻繁に使うDOM要素をキャッシュします。
function cacheElements() {
  els.metricGrid = document.getElementById("metricGrid");
  els.packageFilters = document.getElementById("packageFilters");
  els.riskList = document.getElementById("riskList");
  els.statusBar = document.getElementById("statusBar");
  els.nodeLayer = document.getElementById("nodeLayer");
  els.edgeLayer = document.getElementById("edgeLayer");
  els.networkCanvas = document.getElementById("networkCanvas");
  els.ganttScroller = document.getElementById("ganttScroller");
  els.taskTableBody = document.getElementById("taskTableBody");
  els.inspector = document.getElementById("inspector");
  els.searchInput = document.getElementById("searchInput");
  els.importFile = document.getElementById("importFile");
  els.relationType = document.getElementById("relationType");
  els.lagDays = document.getElementById("lagDays");
  els.addTaskButton = document.getElementById("addTaskButton");
  els.deleteTaskButton = document.getElementById("deleteTaskButton");
  els.linkModeButton = document.getElementById("linkModeButton");
  els.autoLayoutButton = document.getElementById("autoLayoutButton");
  els.exportButton = document.getElementById("exportButton");
  els.importButton = document.getElementById("importButton");
  els.resetButton = document.getElementById("resetButton");
}

// ボタン、タブ、ドラッグ、インポートなどの操作イベントを登録します。
function bindEvents() {
  els.addTaskButton.addEventListener("click", addTask);
  els.deleteTaskButton.addEventListener("click", deleteSelectedTask);
  els.linkModeButton.addEventListener("click", toggleLinkMode);
  els.autoLayoutButton.addEventListener("click", () => {
    autoLayout();
    saveState();
    renderAll();
    setStatus("ネットワークを整列しました");
  });
  els.exportButton.addEventListener("click", exportJson);
  els.importButton.addEventListener("click", () => els.importFile.click());
  els.resetButton.addEventListener("click", resetSample);
  els.importFile.addEventListener("change", importJson);

  els.relationType.addEventListener("change", () => {
    state.linkRelation = els.relationType.value;
    saveState();
  });

  els.lagDays.addEventListener("change", () => {
    state.linkLag = clampInt(els.lagDays.value, -30, 90, 0);
    els.lagDays.value = state.linkLag;
    saveState();
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value.trim();
    saveState();
    renderAll();
  });

  els.packageFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-area]");
    if (!button) return;
    state.activeArea = button.dataset.area;
    saveState();
    renderAll();
  });

  els.nodeLayer.addEventListener("pointerdown", startNodeDrag);
  els.nodeLayer.addEventListener("click", handleNodeClick);
  els.nodeLayer.addEventListener("keydown", (event) => {
    const node = event.target.closest(".task-node");
    if (!node || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    handleNodeAction(node.dataset.id);
  });

  els.ganttScroller.addEventListener("pointerdown", startGanttDrag);
  els.ganttScroller.addEventListener("click", (event) => {
    if (ignoreNextClick) return;
    const bar = event.target.closest(".gantt-bar");
    if (!bar) return;
    state.selectedTaskId = bar.dataset.id;
    saveState();
    renderAll();
  });

  els.taskTableBody.addEventListener("change", handleTableChange);
  els.taskTableBody.addEventListener("click", (event) => {
    const row = event.target.closest("[data-row-id]");
    if (!row) return;
    state.selectedTaskId = row.dataset.rowId;
    saveState();
    renderAll();
  });

  els.inspector.addEventListener("change", handleInspectorChange);
  els.inspector.addEventListener("click", handleInspectorClick);
}

// ブラウザに保存された状態を読み込みます。なければサンプル工程を使います。
function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return normalizeState(JSON.parse(stored));
    }
  } catch (error) {
    console.warn(error);
  }
  return createSeedState();
}

// 編集状態をlocalStorageへ保存します。
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// 初回表示やリセット時に使うサンプル工程データを作ります。
function createSeedState() {
  return {
    project: {
      name: "Greenfield Process Unit",
      startDate: "2026-06-03"
    },
    activeArea: "all",
    selectedTaskId: "T4",
    search: "",
    view: "network",
    linkMode: false,
    linkSourceId: null,
    linkRelation: "FS",
    linkLag: 0,
    tasks: [
      task("T1", "E100", "PFD確定", "Engineering", "Process", "Process Lead", 8, 0, 0, 40, 72),
      task("T2", "E110", "P&ID Rev.B発行", "Engineering", "Process", "Process Lead", 14, 0, 0, 270, 54),
      task("T3", "E120", "HAZOPレビュー", "Engineering", "QA/QC", "HSE Manager", 6, 0, 0, 510, 70),
      task("T4", "P100", "長納期機器RFQ", "Procurement", "Mechanical", "Procurement", 10, 0, 0, 270, 230),
      task("T5", "P110", "ベンダー評価・発注", "Procurement", "Mechanical", "Procurement", 12, 0, 0, 510, 220),
      task("T6", "F100", "圧力容器製作", "Fabrication", "Mechanical", "Vendor A", 35, 0, 0, 760, 210),
      task("T7", "F110", "現地搬入", "Fabrication", "Planning", "Logistics", 8, 0, 0, 1000, 228),
      task("T8", "C100", "造成・仮設", "Construction", "Civil", "Site Civil", 18, 0, 0, 40, 450),
      task("T9", "C110", "基礎施工", "Construction", "Civil", "Site Civil", 20, 0, 0, 270, 445),
      task("T10", "C120", "鉄骨建方", "Construction", "Civil", "Site Construction", 16, 0, 0, 510, 450),
      task("T11", "C130", "機器据付", "Construction", "Mechanical", "Site Mechanical", 12, 0, 0, 760, 440),
      task("T12", "C140", "配管プレファブ・取付", "Construction", "Piping", "Piping Lead", 22, 0, 0, 1000, 450),
      task("T13", "C150", "E&I敷設・結線", "Construction", "E&I", "E&I Lead", 18, 0, 0, 1000, 625),
      task("T14", "M100", "プレコミッショニング", "Commissioning", "QA/QC", "Completions", 10, 0, 0, 760, 625),
      task("T15", "M110", "試運転開始", "Commissioning", "Process", "Commissioning", 7, 0, 0, 510, 625)
    ],
    dependencies: [
      dep("D1", "T1", "T2", "FS", 0),
      dep("D2", "T2", "T3", "FS", 0),
      dep("D3", "T2", "T4", "SS", 4),
      dep("D4", "T4", "T5", "FS", 0),
      dep("D5", "T5", "T6", "FS", 5),
      dep("D6", "T6", "T7", "FS", 0),
      dep("D7", "T8", "T9", "FS", 0),
      dep("D8", "T9", "T10", "FS", 2),
      dep("D9", "T10", "T11", "FS", 0),
      dep("D10", "T7", "T11", "FS", 0),
      dep("D11", "T11", "T12", "SS", 3),
      dep("D12", "T10", "T13", "FS", 0),
      dep("D13", "T12", "T14", "FS", 0),
      dep("D14", "T13", "T14", "FS", 0),
      dep("D15", "T3", "T14", "FS", 0),
      dep("D16", "T14", "T15", "FS", 0)
    ]
  };
}

// タスクデータを作成し、旧版で必要な初期値を補完します。
function task(id, code, name, area, discipline, owner, duration, constraint, progress, x, y) {
  return {
    id,
    code,
    name,
    area,
    discipline,
    owner,
    duration,
    constraint,
    progress,
    x,
    y,
    notes: ""
  };
}

// 依存線データを作成します。
function dep(id, from, to, type, lag) {
  return { id, from, to, type, lag };
}

// 古い保存データでも動くように、不足項目や不正値を補正します。
function normalizeState(input) {
  const seeded = createSeedState();
  const tasks = Array.isArray(input.tasks) ? input.tasks : seeded.tasks;
  const ids = new Set();
  const normalizedTasks = tasks.map((item, index) => {
    const id = String(item.id || uid("T"));
    ids.add(id);
    return {
      id,
      code: String(item.code || `T${String(index + 1).padStart(3, "0")}`),
      name: String(item.name || "未設定タスク"),
      area: AREAS.includes(item.area) ? item.area : AREAS[0],
      discipline: DISCIPLINES.includes(item.discipline) ? item.discipline : DISCIPLINES[0],
      owner: String(item.owner || ""),
      duration: clampInt(item.duration, 1, 365, 5),
      constraint: clampInt(item.constraint, 0, 3650, 0),
      progress: clampInt(item.progress, 0, 100, 0),
      x: clampInt(item.x, 0, 1160, 40 + index * 20),
      y: clampInt(item.y, 0, 700, 60 + index * 30),
      notes: String(item.notes || "")
    };
  });

  const normalizedDeps = Array.isArray(input.dependencies)
    ? input.dependencies
        .filter((item) => ids.has(item.from) && ids.has(item.to) && item.from !== item.to)
        .map((item) => ({
          id: String(item.id || uid("D")),
          from: String(item.from),
          to: String(item.to),
          type: RELATION_LABELS[item.type] ? item.type : "FS",
          lag: clampInt(item.lag, -365, 365, 0)
        }))
    : seeded.dependencies;

  return {
    project: {
      name: String(input.project?.name || seeded.project.name),
      startDate: isIsoDate(input.project?.startDate) ? input.project.startDate : seeded.project.startDate
    },
    activeArea: input.activeArea === "all" || AREAS.includes(input.activeArea) ? input.activeArea : "all",
    selectedTaskId: ids.has(input.selectedTaskId) ? input.selectedTaskId : normalizedTasks[0]?.id || null,
    search: String(input.search || ""),
    view: ["network", "gantt", "table"].includes(input.view) ? input.view : "network",
    linkMode: Boolean(input.linkMode),
    linkSourceId: ids.has(input.linkSourceId) ? input.linkSourceId : null,
    linkRelation: RELATION_LABELS[input.linkRelation] ? input.linkRelation : "FS",
    linkLag: clampInt(input.linkLag, -30, 90, 0),
    tasks: normalizedTasks,
    dependencies: dedupeDependencies(normalizedDeps)
  };
}

// 全ビューの再描画入口です。工程計算後に各領域を更新します。
function renderAll() {
  schedule = calculateSchedule(state.tasks, state.dependencies);
  renderHeaderControls();
  renderTabs();
  renderMetrics();
  renderFilters();
  renderRisks();
  renderNetwork();
  renderGantt();
  renderTable();
  renderInspector();
  updateToolbarState();
}

// ヘッダー内の接続モードや依存設定を現在状態に合わせます。
function renderHeaderControls() {
  els.searchInput.value = state.search || "";
  els.relationType.value = state.linkRelation || "FS";
  els.lagDays.value = state.linkLag || 0;
}

// ネットワーク、ガント、表のタブ状態を更新します。
function renderTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.dataset.view === state.view);
  });
}

// 工期、タスク数、依存線数、クリティカル数などの概要を描画します。
function renderMetrics() {
  const metrics = [
    { value: `${Math.round(schedule.projectDuration)}日`, label: "計算工期" },
    { value: state.tasks.length, label: "タスク" },
    { value: state.dependencies.length, label: "依存線" },
    { value: `${schedule.criticalCount}`, label: "クリティカル" }
  ];

  els.metricGrid.innerHTML = metrics
    .map(
      (item) => `
        <div class="metric">
          <span class="metric-value">${escapeHtml(item.value)}</span>
          <span class="metric-label">${escapeHtml(item.label)}</span>
        </div>
      `
    )
    .join("");
}

// 領域フィルターを描画します。
function renderFilters() {
  const counts = new Map(AREAS.map((area) => [area, 0]));
  state.tasks.forEach((taskItem) => counts.set(taskItem.area, (counts.get(taskItem.area) || 0) + 1));
  const filters = [
    { area: "all", label: "すべて", count: state.tasks.length },
    ...AREAS.map((area) => ({ area, label: area, count: counts.get(area) || 0 }))
  ];

  els.packageFilters.innerHTML = filters
    .map(
      (filter) => `
        <button class="filter-chip ${state.activeArea === filter.area ? "active" : ""}" data-area="${escapeAttr(filter.area)}">
          <span>${escapeHtml(filter.label)}</span>
          <span class="pill">${filter.count}</span>
        </button>
      `
    )
    .join("");
}

// クリティカルや余裕日数が少ない注視タスクを描画します。
function renderRisks() {
  const riskyTasks = state.tasks
    .map((taskItem) => ({ task: taskItem, data: schedule.tasks.get(taskItem.id) }))
    .filter((item) => item.data && (item.data.critical || item.data.float <= 3 || item.task.progress < 20))
    .sort((a, b) => a.data.float - b.data.float || b.task.duration - a.task.duration)
    .slice(0, 5);

  if (!riskyTasks.length) {
    els.riskList.innerHTML = `<div class="risk-item"><strong>なし</strong><span>現在のフィルタで表示対象なし</span></div>`;
    return;
  }

  els.riskList.innerHTML = riskyTasks
    .map(({ task: taskItem, data }) => {
      const label = data.critical ? "クリティカル" : `余裕 ${Math.max(0, Math.round(data.float))}日`;
      return `
        <button class="risk-item" data-risk-id="${escapeAttr(taskItem.id)}">
          <strong>${escapeHtml(taskItem.code)} ${escapeHtml(taskItem.name)}</strong>
          <span>${escapeHtml(label)} · ${escapeHtml(taskItem.owner || "担当未設定")}</span>
        </button>
      `;
    })
    .join("");

  els.riskList.querySelectorAll("[data-risk-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTaskId = button.dataset.riskId;
      saveState();
      renderAll();
    });
  });
}

// ネットワークビューのノードと依存線を描画します。
function renderNetwork() {
  const visibleTasks = getVisibleTasks();
  const visibleIds = new Set(visibleTasks.map((taskItem) => taskItem.id));
  renderEdges(visibleIds);

  els.nodeLayer.innerHTML = "";
  const template = document.getElementById("taskNodeTemplate");

  visibleTasks.forEach((taskItem) => {
    const data = schedule.tasks.get(taskItem.id);
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = taskItem.id;
    node.style.left = `${taskItem.x}px`;
    node.style.top = `${taskItem.y}px`;
    node.classList.toggle("selected", taskItem.id === state.selectedTaskId);
    node.classList.toggle("critical", Boolean(data?.critical));
    node.classList.toggle("link-source", taskItem.id === state.linkSourceId && state.linkMode);
    node.querySelector(".node-code").textContent = taskItem.code;
    node.querySelector(".node-area").textContent = taskItem.area;
    node.querySelector(".node-name").textContent = taskItem.name;
    node.querySelector(".node-duration").textContent = `${taskItem.duration}日`;
    node.querySelector(".node-float").textContent = data?.critical ? "Critical" : `Float ${Math.max(0, Math.round(data?.float || 0))}日`;
    node.querySelector(".progress-fill").style.width = `${taskItem.progress}%`;
    els.nodeLayer.appendChild(node);
  });
}

// SVGで依存線を描画します。
function renderEdges(visibleIds = new Set(getVisibleTasks().map((taskItem) => taskItem.id))) {
  const taskById = getTaskMap();
  const width = els.networkCanvas.offsetWidth || 1380;
  const height = els.networkCanvas.offsetHeight || 850;
  els.edgeLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
  els.edgeLayer.setAttribute("width", width);
  els.edgeLayer.setAttribute("height", height);

  const defs = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#71807a"></path>
      </marker>
      <marker id="arrowCritical" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#b74645"></path>
      </marker>
    </defs>
  `;

  const paths = state.dependencies
    .filter((item) => visibleIds.has(item.from) && visibleIds.has(item.to))
    .map((item) => {
      const from = taskById.get(item.from);
      const to = taskById.get(item.to);
      if (!from || !to) return "";
      const fromData = schedule.tasks.get(from.id);
      const toData = schedule.tasks.get(to.id);
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;
      const dx = Math.max(70, Math.abs(x2 - x1) * 0.45);
      const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      const labelX = (x1 + x2) / 2;
      const labelY = (y1 + y2) / 2 - 8;
      const critical = isDependencyCritical(item, from, to, fromData, toData);
      const marker = critical ? "arrowCritical" : "arrow";
      const lag = Number(item.lag) > 0 ? `+${item.lag}` : Number(item.lag) < 0 ? item.lag : "";
      return `
        <path class="dependency-edge ${critical ? "critical" : ""}" d="${path}" marker-end="url(#${marker})"></path>
        <text class="dependency-label" x="${labelX}" y="${labelY}">${escapeHtml(item.type)}${escapeHtml(String(lag))}</text>
      `;
    })
    .join("");

  els.edgeLayer.innerHTML = defs + paths;
}

// CPM計算結果を使い、簡易ガントチャートを描画します。
function renderGantt() {
  const visibleTasks = getVisibleTasks().sort((a, b) => {
    const aData = schedule.tasks.get(a.id);
    const bData = schedule.tasks.get(b.id);
    return (aData?.es || 0) - (bData?.es || 0) || a.code.localeCompare(b.code);
  });
  const chartDays = Math.max(35, Math.ceil(schedule.projectDuration + 14));
  const timelineWidth = chartDays * DAY_WIDTH;
  const ticks = [];
  for (let day = 0; day <= chartDays; day += 7) {
    ticks.push(`
      <div class="tick" style="left:${day * DAY_WIDTH}px">
        <span>${escapeHtml(formatDate(addDays(state.project.startDate, day)))}</span>
      </div>
    `);
  }

  const rows = visibleTasks
    .map((taskItem) => {
      const data = schedule.tasks.get(taskItem.id);
      const es = Math.max(0, Math.round(data?.es || 0));
      const width = Math.max(16, taskItem.duration * DAY_WIDTH);
      return `
        <div class="gantt-row" data-row-id="${escapeAttr(taskItem.id)}">
          <div class="gantt-label">
            <strong>${escapeHtml(taskItem.code)} ${escapeHtml(taskItem.name)}</strong>
            <span>${escapeHtml(taskItem.area)} · ${escapeHtml(taskItem.owner || "担当未設定")}</span>
          </div>
          <div class="gantt-line" style="width:${timelineWidth}px">
            <div class="gantt-bar ${data?.critical ? "critical" : ""} ${taskItem.id === state.selectedTaskId ? "selected" : ""}"
              data-id="${escapeAttr(taskItem.id)}"
              style="left:${es * DAY_WIDTH}px;width:${width}px"
              title="${escapeAttr(taskItem.code)} ${escapeAttr(taskItem.name)}">
              <div class="gantt-bar-fill" style="width:${taskItem.progress}%"></div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  els.ganttScroller.innerHTML = `
    <div class="gantt-chart" style="width:${timelineWidth + 286}px">
      <div class="gantt-header">
        <div class="gantt-left-head">タスク</div>
        <div class="gantt-timeline" style="width:${timelineWidth}px">${ticks.join("")}</div>
      </div>
      ${rows || `<div class="gantt-row"><div class="gantt-label"><strong>表示対象なし</strong></div><div></div></div>`}
    </div>
  `;
}

// 編集可能な工程表を描画します。
function renderTable() {
  const visibleTasks = getVisibleTasks().sort((a, b) => a.code.localeCompare(b.code));
  els.taskTableBody.innerHTML = visibleTasks
    .map((taskItem) => {
      const data = schedule.tasks.get(taskItem.id);
      const predecessorCodes = getPredecessorCodes(taskItem.id).join(", ");
      const floatValue = data?.critical ? "Critical" : `${Math.max(0, Math.round(data?.float || 0))}日`;
      return `
        <tr class="${taskItem.id === state.selectedTaskId ? "selected" : ""}" data-row-id="${escapeAttr(taskItem.id)}">
          <td><input data-id="${escapeAttr(taskItem.id)}" data-field="code" value="${escapeAttr(taskItem.code)}"></td>
          <td><input data-id="${escapeAttr(taskItem.id)}" data-field="name" value="${escapeAttr(taskItem.name)}"></td>
          <td>
            <select data-id="${escapeAttr(taskItem.id)}" data-field="area">
              ${optionsHtml(AREAS, taskItem.area)}
            </select>
          </td>
          <td><input data-id="${escapeAttr(taskItem.id)}" data-field="owner" value="${escapeAttr(taskItem.owner)}"></td>
          <td class="number-cell"><input type="number" min="1" max="365" data-id="${escapeAttr(taskItem.id)}" data-field="duration" value="${taskItem.duration}"></td>
          <td class="number-cell"><input type="number" min="0" max="3650" data-id="${escapeAttr(taskItem.id)}" data-field="constraint" value="${taskItem.constraint}"></td>
          <td class="number-cell"><input type="number" min="0" max="100" data-id="${escapeAttr(taskItem.id)}" data-field="progress" value="${taskItem.progress}"></td>
          <td class="predecessor-cell"><input data-id="${escapeAttr(taskItem.id)}" data-field="preds" value="${escapeAttr(predecessorCodes)}"></td>
          <td class="float-cell ${data?.critical ? "critical-text" : ""}">${escapeHtml(floatValue)}</td>
        </tr>
      `;
    })
    .join("");
}

// 選択中タスクの詳細編集パネルを描画します。
function renderInspector() {
  const selected = getSelectedTask();
  if (!selected) {
    els.inspector.innerHTML = `
      <div class="empty-inspector">
        <div class="section-heading">詳細</div>
        <p>タスクを選択</p>
      </div>
    `;
    return;
  }

  const data = schedule.tasks.get(selected.id);
  const incoming = state.dependencies.filter((item) => item.to === selected.id);
  const predecessorRows = incoming
    .map((item) => {
      const from = getTask(item.from);
      if (!from) return "";
      return `
        <div class="dependency-row">
          <strong title="${escapeAttr(from.name)}">${escapeHtml(from.code)} ${escapeHtml(from.name)}</strong>
          <select data-dep-id="${escapeAttr(item.id)}" data-dep-field="type">
            ${optionsHtml(Object.keys(RELATION_LABELS), item.type)}
          </select>
          <input type="number" min="-365" max="365" data-dep-id="${escapeAttr(item.id)}" data-dep-field="lag" value="${item.lag}">
          <button type="button" data-remove-dep="${escapeAttr(item.id)}" title="依存削除" aria-label="依存削除">×</button>
        </div>
      `;
    })
    .join("");

  const availablePreds = state.tasks.filter((taskItem) => taskItem.id !== selected.id);

  els.inspector.innerHTML = `
    <section class="inspector-section">
      <div class="section-heading">詳細</div>
      <h2>${escapeHtml(selected.code)} ${escapeHtml(selected.name)}</h2>
      <div class="inspector-summary">
        <span class="summary-pill ${data?.critical ? "critical" : ""}">${data?.critical ? "Critical" : `Float ${Math.max(0, Math.round(data?.float || 0))}日`}</span>
        <span class="summary-pill">ES ${Math.round(data?.es || 0)}日</span>
        <span class="summary-pill">EF ${Math.round(data?.ef || 0)}日</span>
      </div>
      <div class="field-grid">
        <label class="wide">タスク名
          <input data-inspector-field="name" value="${escapeAttr(selected.name)}">
        </label>
        <label>コード
          <input data-inspector-field="code" value="${escapeAttr(selected.code)}">
        </label>
        <label>領域
          <select data-inspector-field="area">${optionsHtml(AREAS, selected.area)}</select>
        </label>
        <label>担当
          <input data-inspector-field="owner" value="${escapeAttr(selected.owner)}">
        </label>
        <label>専門
          <select data-inspector-field="discipline">${optionsHtml(DISCIPLINES, selected.discipline)}</select>
        </label>
        <label>期間(日)
          <input type="number" min="1" max="365" data-inspector-field="duration" value="${selected.duration}">
        </label>
        <label>最早制約(日)
          <input type="number" min="0" max="3650" data-inspector-field="constraint" value="${selected.constraint}">
        </label>
        <label>進捗(%)
          <input type="number" min="0" max="100" data-inspector-field="progress" value="${selected.progress}">
        </label>
        <label class="wide">メモ
          <textarea rows="3" data-inspector-field="notes">${escapeHtml(selected.notes || "")}</textarea>
        </label>
      </div>
    </section>

    <section class="inspector-section">
      <div class="section-heading">先行タスク</div>
      <div class="dependency-list">
        ${predecessorRows || `<div class="risk-item"><strong>なし</strong><span>開始条件なし</span></div>`}
      </div>
      <div class="dependency-editor">
        <label>追加
          <select id="newPredecessorSelect">
            ${availablePreds.map((taskItem) => `<option value="${escapeAttr(taskItem.id)}">${escapeHtml(taskItem.code)} ${escapeHtml(taskItem.name)}</option>`).join("")}
          </select>
        </label>
        <label>種別
          <select id="newPredecessorType">${optionsHtml(Object.keys(RELATION_LABELS), state.linkRelation)}</select>
        </label>
        <label>ラグ
          <input id="newPredecessorLag" type="number" min="-365" max="365" value="${state.linkLag || 0}">
        </label>
        <button type="button" id="addPredecessorButton" title="先行追加" aria-label="先行追加">+</button>
      </div>
      <button type="button" class="delete-action" data-delete-selected>選択タスクを削除</button>
    </section>
  `;
}

// 選択状態や接続モードに合わせてツールバー表示を更新します。
function updateToolbarState() {
  const selected = getSelectedTask();
  els.deleteTaskButton.disabled = !selected;
  els.linkModeButton.classList.toggle("active", state.linkMode);

  if (schedule.hasCycle) {
    setStatus("循環依存があります。依存線を見直してください。", "error");
  } else if (state.linkMode && state.linkSourceId) {
    const source = getTask(state.linkSourceId);
    setStatus(`${source?.code || ""} から接続中`, "warning");
  } else if (state.linkMode) {
    setStatus("依存線モード", "warning");
  } else if (!els.statusBar.textContent || els.statusBar.textContent === "Ready") {
    setStatus("Ready");
  }
}

// 表示ビューを切り替えます。
function setView(view) {
  state.view = view;
  saveState();
  renderAll();
}

// 画面下部の状態メッセージを更新します。
function setStatus(message, type = "") {
  els.statusBar.textContent = message;
  els.statusBar.className = `statusbar ${type}`.trim();
}

// 新規タスクを追加して選択状態にします。
function addTask() {
  const index = state.tasks.length + 1;
  const area = state.activeArea !== "all" ? state.activeArea : "Engineering";
  const id = uid("T");
  const newTask = {
    id,
    code: nextTaskCode(area),
    name: "新規タスク",
    area,
    discipline: "Planning",
    owner: "",
    duration: 5,
    constraint: 0,
    progress: 0,
    x: 80 + (index % 4) * 225,
    y: 100 + Math.floor(index / 4) * 135,
    notes: ""
  };
  state.tasks.push(newTask);
  state.selectedTaskId = id;
  saveState();
  renderAll();
  setStatus("タスクを追加しました");
}

// 選択中タスクを削除します。
function deleteSelectedTask() {
  const selected = getSelectedTask();
  if (!selected) return;
  const confirmed = window.confirm(`${selected.code} を削除しますか？`);
  if (!confirmed) return;
  state.tasks = state.tasks.filter((taskItem) => taskItem.id !== selected.id);
  state.dependencies = state.dependencies.filter((item) => item.from !== selected.id && item.to !== selected.id);
  state.selectedTaskId = state.tasks[0]?.id || null;
  state.linkSourceId = state.linkSourceId === selected.id ? null : state.linkSourceId;
  saveState();
  renderAll();
  setStatus("タスクを削除しました");
}

// 依存接続モードをON/OFFします。
function toggleLinkMode() {
  state.linkMode = !state.linkMode;
  if (!state.linkMode) {
    state.linkSourceId = null;
  }
  saveState();
  renderAll();
}

// ネットワーク上のノードクリックを受け取り、タスク操作へ渡します。
function handleNodeClick(event) {
  const node = event.target.closest(".task-node");
  if (!node) return;
  if (ignoreNextClick) return;
  handleNodeAction(node.dataset.id);
}

// 通常選択または依存接続のどちらかとしてノード操作を処理します。
function handleNodeAction(id) {
  if (!id) return;
  if (!state.linkMode) {
    state.selectedTaskId = id;
    saveState();
    renderAll();
    return;
  }

  if (!state.linkSourceId || state.linkSourceId === id) {
    state.linkSourceId = state.linkSourceId === id ? null : id;
    state.selectedTaskId = id;
    saveState();
    renderAll();
    return;
  }

  const added = addDependency(state.linkSourceId, id, state.linkRelation, state.linkLag);
  state.selectedTaskId = id;
  if (added) {
    const source = getTask(state.linkSourceId);
    const target = getTask(id);
    setStatus(`${source?.code || ""} → ${target?.code || ""} を接続しました`);
  }
  saveState();
  renderAll();
}

// ネットワーク上のノードドラッグを開始します。
function startNodeDrag(event) {
  const node = event.target.closest(".task-node");
  if (!node || state.linkMode) return;
  const taskItem = getTask(node.dataset.id);
  if (!taskItem) return;
  event.preventDefault();
  dragState = {
    id: taskItem.id,
    node,
    startX: event.clientX,
    startY: event.clientY,
    originX: taskItem.x,
    originY: taskItem.y,
    moved: false
  };
  node.classList.add("dragging");
  node.setPointerCapture(event.pointerId);
  document.addEventListener("pointermove", moveNode);
  document.addEventListener("pointerup", endNodeDrag, { once: true });
}

// ドラッグ中のノード位置を更新します。
function moveNode(event) {
  if (!dragState) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  if (Math.abs(dx) + Math.abs(dy) > 4) dragState.moved = true;
  const taskItem = getTask(dragState.id);
  if (!taskItem) return;
  taskItem.x = clampInt(dragState.originX + dx, 8, 1168, dragState.originX);
  taskItem.y = clampInt(dragState.originY + dy, 8, 720, dragState.originY);
  dragState.node.style.left = `${taskItem.x}px`;
  dragState.node.style.top = `${taskItem.y}px`;
  renderEdges();
}

// ノードドラッグを終了し、位置を保存します。
function endNodeDrag() {
  if (!dragState) return;
  dragState.node.classList.remove("dragging");
  if (dragState.moved) {
    ignoreNextClick = true;
    setTimeout(() => {
      ignoreNextClick = false;
    }, 0);
    saveState();
  }
  document.removeEventListener("pointermove", moveNode);
  dragState = null;
}

// ガントバーのドラッグ編集を開始します。
function startGanttDrag(event) {
  const bar = event.target.closest(".gantt-bar");
  if (!bar) return;
  const taskItem = getTask(bar.dataset.id);
  if (!taskItem) return;
  const data = schedule.tasks.get(taskItem.id);
  event.preventDefault();
  ganttDragState = {
    id: taskItem.id,
    bar,
    startX: event.clientX,
    startDay: Math.round(data?.es || taskItem.constraint || 0),
    moved: false
  };
  bar.setPointerCapture(event.pointerId);
  document.addEventListener("pointermove", moveGanttBar);
  document.addEventListener("pointerup", endGanttDrag, { once: true });
}

// ガントバーのドラッグ中に期間を更新します。
function moveGanttBar(event) {
  if (!ganttDragState) return;
  const dx = event.clientX - ganttDragState.startX;
  const day = Math.max(0, Math.round(ganttDragState.startDay + dx / DAY_WIDTH));
  if (Math.abs(dx) > 4) ganttDragState.moved = true;
  ganttDragState.bar.style.left = `${day * DAY_WIDTH}px`;
}

// ガントバーのドラッグ終了時に編集内容を確定します。
function endGanttDrag(event) {
  if (!ganttDragState) return;
  const taskItem = getTask(ganttDragState.id);
  const dx = event.clientX - ganttDragState.startX;
  const day = Math.max(0, Math.round(ganttDragState.startDay + dx / DAY_WIDTH));
  if (taskItem && ganttDragState.moved) {
    taskItem.constraint = day;
    state.selectedTaskId = taskItem.id;
    ignoreNextClick = true;
    setTimeout(() => {
      ignoreNextClick = false;
    }, 0);
    saveState();
    renderAll();
    setStatus(`${taskItem.code} の最早制約を ${day}日に変更しました`);
  }
  document.removeEventListener("pointermove", moveGanttBar);
  ganttDragState = null;
}

// 表ビューの編集内容をタスク状態へ反映します。
function handleTableChange(event) {
  const target = event.target;
  const id = target.dataset.id;
  const field = target.dataset.field;
  if (!id || !field) return;
  if (field === "preds") {
    updatePredecessorsFromCodes(id, target.value);
  } else {
    updateTaskField(id, field, target.value);
  }
}

// 詳細パネルの入力変更をタスクまたは依存線へ反映します。
function handleInspectorChange(event) {
  const target = event.target;
  if (target.dataset.inspectorField) {
    updateTaskField(state.selectedTaskId, target.dataset.inspectorField, target.value);
    return;
  }
  if (target.dataset.depId && target.dataset.depField) {
    const dependency = state.dependencies.find((item) => item.id === target.dataset.depId);
    if (!dependency) return;
    if (target.dataset.depField === "type") {
      dependency.type = RELATION_LABELS[target.value] ? target.value : "FS";
    }
    if (target.dataset.depField === "lag") {
      dependency.lag = clampInt(target.value, -365, 365, 0);
    }
    if (hasCycle(state.tasks, state.dependencies)) {
      setStatus("循環依存になるため変更できません", "error");
      renderAll();
      return;
    }
    saveState();
    renderAll();
  }
}

// 詳細パネル内の削除や追加ボタンを処理します。
function handleInspectorClick(event) {
  const removeId = event.target.closest("[data-remove-dep]")?.dataset.removeDep;
  if (removeId) {
    state.dependencies = state.dependencies.filter((item) => item.id !== removeId);
    saveState();
    renderAll();
    setStatus("依存線を削除しました");
    return;
  }

  if (event.target.closest("#addPredecessorButton")) {
    const selected = getSelectedTask();
    const predecessorId = document.getElementById("newPredecessorSelect")?.value;
    const type = document.getElementById("newPredecessorType")?.value || "FS";
    const lag = clampInt(document.getElementById("newPredecessorLag")?.value, -365, 365, 0);
    if (selected && predecessorId) {
      addDependency(predecessorId, selected.id, type, lag);
      saveState();
      renderAll();
    }
    return;
  }

  if (event.target.closest("[data-delete-selected]")) {
    deleteSelectedTask();
  }
}

// タスクの単一フィールドを型に合わせて更新します。
function updateTaskField(id, field, rawValue) {
  const taskItem = getTask(id);
  if (!taskItem) return;

  if (field === "code") {
    const value = String(rawValue).trim().toUpperCase();
    if (!value) {
      setStatus("コードは空にできません", "error");
      renderAll();
      return;
    }
    const duplicate = state.tasks.some((item) => item.id !== id && item.code.toUpperCase() === value);
    if (duplicate) {
      setStatus("コードが重複しています", "error");
      renderAll();
      return;
    }
    taskItem.code = value;
  } else if (field === "name") {
    taskItem.name = String(rawValue).trim() || "未設定タスク";
  } else if (field === "area") {
    taskItem.area = AREAS.includes(rawValue) ? rawValue : taskItem.area;
  } else if (field === "discipline") {
    taskItem.discipline = DISCIPLINES.includes(rawValue) ? rawValue : taskItem.discipline;
  } else if (field === "owner") {
    taskItem.owner = String(rawValue).trim();
  } else if (field === "duration") {
    taskItem.duration = clampInt(rawValue, 1, 365, taskItem.duration);
  } else if (field === "constraint") {
    taskItem.constraint = clampInt(rawValue, 0, 3650, taskItem.constraint);
  } else if (field === "progress") {
    taskItem.progress = clampInt(rawValue, 0, 100, taskItem.progress);
  } else if (field === "notes") {
    taskItem.notes = String(rawValue);
  }

  state.selectedTaskId = id;
  saveState();
  renderAll();
}

// 表や詳細で入力された先行コード一覧から依存線を作り直します。
function updatePredecessorsFromCodes(taskId, rawValue) {
  const target = getTask(taskId);
  if (!target) return;
  const codes = String(rawValue)
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  const predecessors = [];
  for (const code of codes) {
    const predecessor = state.tasks.find((item) => item.code.toUpperCase() === code);
    if (!predecessor) {
      setStatus(`${code} が見つかりません`, "error");
      renderAll();
      return;
    }
    if (predecessor.id === target.id) {
      setStatus("自分自身は先行タスクにできません", "error");
      renderAll();
      return;
    }
    predecessors.push(predecessor.id);
  }

  const oldDependencies = state.dependencies.slice();
  state.dependencies = state.dependencies.filter((item) => item.to !== target.id);
  predecessors.forEach((fromId) => {
    state.dependencies.push(dep(uid("D"), fromId, target.id, state.linkRelation || "FS", state.linkLag || 0));
  });

  if (hasCycle(state.tasks, state.dependencies)) {
    state.dependencies = oldDependencies;
    setStatus("循環依存になるため変更できません", "error");
    renderAll();
    return;
  }

  state.dependencies = dedupeDependencies(state.dependencies);
  state.selectedTaskId = taskId;
  saveState();
  renderAll();
  setStatus("先行タスクを更新しました");
}

// 循環依存を避けながら依存線を追加します。
function addDependency(fromId, toId, type = "FS", lag = 0) {
  if (!fromId || !toId || fromId === toId) {
    setStatus("自分自身には接続できません", "error");
    return false;
  }

  const existing = state.dependencies.find((item) => item.from === fromId && item.to === toId);
  if (existing) {
    existing.type = RELATION_LABELS[type] ? type : "FS";
    existing.lag = clampInt(lag, -365, 365, 0);
    saveState();
    renderAll();
    setStatus("依存線を更新しました");
    return true;
  }

  const newDependency = dep(uid("D"), fromId, toId, RELATION_LABELS[type] ? type : "FS", clampInt(lag, -365, 365, 0));
  state.dependencies.push(newDependency);
  if (hasCycle(state.tasks, state.dependencies)) {
    state.dependencies = state.dependencies.filter((item) => item.id !== newDependency.id);
    setStatus("循環依存になるため接続できません", "error");
    return false;
  }
  saveState();
  return true;
}

// 依存関係に沿って左から右へ並ぶように自動整列します。
function autoLayout() {
  const calculated = calculateSchedule(state.tasks, state.dependencies);
  const lanes = new Map();
  const sorted = state.tasks.slice().sort((a, b) => {
    const aData = calculated.tasks.get(a.id);
    const bData = calculated.tasks.get(b.id);
    return (aData?.es || 0) - (bData?.es || 0) || a.code.localeCompare(b.code);
  });

  sorted.forEach((taskItem) => {
    const data = calculated.tasks.get(taskItem.id);
    const laneKey = taskItem.area;
    const laneIndex = lanes.get(laneKey) || 0;
    lanes.set(laneKey, laneIndex + 1);
    const areaIndex = AREAS.indexOf(taskItem.area);
    taskItem.x = 40 + Math.min(5, Math.floor((data?.es || 0) / 18)) * 225;
    taskItem.y = 48 + areaIndex * 150 + (laneIndex % 2) * 24;
  });
}

// 内蔵サンプル工程へ戻します。
function resetSample() {
  const confirmed = window.confirm("サンプル工程へ戻しますか？");
  if (!confirmed) return;
  state = createSeedState();
  saveState();
  renderAll();
  setStatus("サンプル工程へ戻しました");
}

// 現在の工程データをJSONとしてダウンロードします。
function exportJson() {
  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      ...state
    },
    null,
    2
  );
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `epc-dependency-plan-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("JSONをエクスポートしました");
}

// JSONファイルを読み込み、工程データとして反映します。
function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = normalizeState(JSON.parse(String(reader.result)));
      if (hasCycle(state.tasks, state.dependencies)) {
        state.dependencies = [];
        setStatus("循環依存を含むため依存線をクリアしました", "error");
      } else {
        setStatus("JSONをインポートしました");
      }
      saveState();
      renderAll();
    } catch (error) {
      console.error(error);
      setStatus("JSONを読み込めませんでした", "error");
    } finally {
      els.importFile.value = "";
    }
  };
  reader.readAsText(file);
}

// CPM風に最早/最遅日、余裕日数、クリティカル判定を計算します。
function calculateSchedule(tasks, dependencies) {
  const taskById = new Map(tasks.map((taskItem) => [taskItem.id, taskItem]));
  const result = new Map();
  tasks.forEach((taskItem) => {
    result.set(taskItem.id, {
      es: clampInt(taskItem.constraint, 0, 3650, 0),
      ef: clampInt(taskItem.constraint, 0, 3650, 0) + clampInt(taskItem.duration, 1, 365, 1),
      ls: 0,
      lf: 0,
      float: 0,
      critical: false
    });
  });

  const outgoing = new Map(tasks.map((taskItem) => [taskItem.id, []]));
  const incoming = new Map(tasks.map((taskItem) => [taskItem.id, []]));
  const indegree = new Map(tasks.map((taskItem) => [taskItem.id, 0]));

  dependencies.forEach((item) => {
    if (!taskById.has(item.from) || !taskById.has(item.to)) return;
    outgoing.get(item.from).push(item);
    incoming.get(item.to).push(item);
    indegree.set(item.to, (indegree.get(item.to) || 0) + 1);
  });

  const queue = tasks
    .filter((taskItem) => (indegree.get(taskItem.id) || 0) === 0)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((taskItem) => taskItem.id);
  const topo = [];

  while (queue.length) {
    const id = queue.shift();
    topo.push(id);
    outgoing.get(id).forEach((item) => {
      const nextDegree = (indegree.get(item.to) || 0) - 1;
      indegree.set(item.to, nextDegree);
      if (nextDegree === 0) {
        queue.push(item.to);
        queue.sort((a, b) => (taskById.get(a)?.code || "").localeCompare(taskById.get(b)?.code || ""));
      }
    });
  }

  const hasCycleValue = topo.length !== tasks.length;
  if (!hasCycleValue) {
    topo.forEach((id) => {
      const current = result.get(id);
      const currentTask = taskById.get(id);
      current.es = Math.max(current.es, clampInt(currentTask.constraint, 0, 3650, 0));
      current.ef = current.es + currentTask.duration;
      outgoing.get(id).forEach((item) => {
        const toTask = taskById.get(item.to);
        const target = result.get(item.to);
        const candidate = current.es + dependencyOffset(item, currentTask, toTask);
        target.es = Math.max(target.es, candidate, clampInt(toTask.constraint, 0, 3650, 0));
      });
    });

    topo.forEach((id) => {
      const data = result.get(id);
      const taskItem = taskById.get(id);
      data.ef = data.es + taskItem.duration;
    });
  }

  const projectDuration = Math.max(0, ...Array.from(result.values()).map((item) => item.ef));

  if (!hasCycleValue) {
    tasks.forEach((taskItem) => {
      const data = result.get(taskItem.id);
      data.ls = projectDuration - taskItem.duration;
      data.lf = projectDuration;
    });

    topo
      .slice()
      .reverse()
      .forEach((id) => {
        const currentTask = taskById.get(id);
        const current = result.get(id);
        outgoing.get(id).forEach((item) => {
          const toTask = taskById.get(item.to);
          const target = result.get(item.to);
          const offset = dependencyOffset(item, currentTask, toTask);
          current.ls = Math.min(current.ls, target.ls - offset);
        });
        current.lf = current.ls + currentTask.duration;
        current.float = current.ls - current.es;
        current.critical = current.float <= 0.001;
      });
  }

  const criticalCount = Array.from(result.values()).filter((item) => item.critical).length;
  return {
    tasks: result,
    outgoing,
    incoming,
    projectDuration,
    criticalCount,
    hasCycle: hasCycleValue
  };
}

// FS/SS/FF/SFの依存種別を開始日基準のオフセットへ変換します。
function dependencyOffset(item, fromTask, toTask) {
  const lag = Number(item.lag) || 0;
  const fromDuration = Number(fromTask?.duration) || 0;
  const toDuration = Number(toTask?.duration) || 0;
  if (item.type === "SS") return lag;
  if (item.type === "FF") return fromDuration + lag - toDuration;
  if (item.type === "SF") return lag - toDuration;
  return fromDuration + lag;
}

// 新しい依存を追加しても循環しないか確認します。
function hasCycle(tasks, dependencies) {
  const taskIds = new Set(tasks.map((taskItem) => taskItem.id));
  const outgoing = new Map(tasks.map((taskItem) => [taskItem.id, []]));
  const indegree = new Map(tasks.map((taskItem) => [taskItem.id, 0]));

  dependencies.forEach((item) => {
    if (!taskIds.has(item.from) || !taskIds.has(item.to)) return;
    outgoing.get(item.from).push(item.to);
    indegree.set(item.to, (indegree.get(item.to) || 0) + 1);
  });

  const queue = tasks.filter((taskItem) => indegree.get(taskItem.id) === 0).map((taskItem) => taskItem.id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    outgoing.get(id).forEach((toId) => {
      const next = indegree.get(toId) - 1;
      indegree.set(toId, next);
      if (next === 0) queue.push(toId);
    });
  }
  return visited !== tasks.length;
}

// 依存線がクリティカルパス上にあるか判定します。
function isDependencyCritical(item, fromTask, toTask, fromData, toData) {
  if (!fromData || !toData || !fromData.critical || !toData.critical) return false;
  const offset = dependencyOffset(item, fromTask, toTask);
  return Math.abs(toData.es - (fromData.es + offset)) < 0.001;
}

// 現在の検索・領域フィルターに合うタスクだけを返します。
function getVisibleTasks() {
  const query = (state.search || "").trim().toLowerCase();
  return state.tasks.filter((taskItem) => {
    const areaMatch = state.activeArea === "all" || taskItem.area === state.activeArea;
    const haystack = `${taskItem.code} ${taskItem.name} ${taskItem.area} ${taskItem.discipline} ${taskItem.owner}`.toLowerCase();
    return areaMatch && (!query || haystack.includes(query));
  });
}

// タスクIDからタスクを引きやすいMapを作ります。
function getTaskMap() {
  return new Map(state.tasks.map((taskItem) => [taskItem.id, taskItem]));
}

// タスクIDからタスクを探します。
function getTask(id) {
  return state.tasks.find((taskItem) => taskItem.id === id);
}

// 現在選択中のタスクを返します。
function getSelectedTask() {
  return getTask(state.selectedTaskId);
}

// 表示用に、先行タスクのコード一覧を返します。
function getPredecessorCodes(taskId) {
  return state.dependencies
    .filter((item) => item.to === taskId)
    .map((item) => getTask(item.from)?.code)
    .filter(Boolean);
}

// 同じ接続の依存線が重複しないように整理します。
function dedupeDependencies(dependencies) {
  const seen = new Set();
  const clean = [];
  dependencies.forEach((item) => {
    const key = `${item.from}->${item.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    clean.push(item);
  });
  return clean;
}

// 領域ごとの次のタスクコードを採番します。
function nextTaskCode(area) {
  const prefixMap = {
    Engineering: "E",
    Procurement: "P",
    Fabrication: "F",
    Construction: "C",
    Commissioning: "M"
  };
  const prefix = prefixMap[area] || "T";
  const numbers = state.tasks
    .map((taskItem) => taskItem.code.match(new RegExp(`^${prefix}(\\d+)$`, "i"))?.[1])
    .filter(Boolean)
    .map(Number);
  const next = numbers.length ? Math.max(...numbers) + 10 : 100;
  return `${prefix}${next}`;
}

// select要素に差し込むoption HTMLを作ります。
function optionsHtml(values, selected) {
  return values
    .map((value) => `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`)
    .join("");
}

// 画面内で使う一意IDを生成します。
function uid(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

// 数値を範囲内に丸め、不正値ならフォールバックを返します。
function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

// HTMLへ差し込む文字列をエスケープします。
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 属性値用のエスケープです。
function escapeAttr(value) {
  return escapeHtml(value);
}

// YYYY-MM-DD形式の日付文字列かどうかを確認します。
function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ISO日付に日数を足した日付文字列を返します。
function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date;
}

// DateをYYYY-MM-DD形式へ整形します。
function formatDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
