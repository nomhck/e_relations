const STORAGE_KEY = "e-relations-gui-v1";
const NODE_W = 196;
const NODE_H = 132;
const DAY_W = 18;
const DEFAULT_AREAS = ["Engineering", "Procurement", "Fabrication", "Construction", "Commissioning"];
const AREA_COLORS = ["#287d7c", "#315d95", "#8b5a2b", "#6d7f3f", "#8d4970", "#5b6f92", "#9a5a34"];
const RELATIONS = ["FS", "SS", "FF", "SF"];
const STATUSES = [
  ["todo", "未着手"],
  ["doing", "進行中"],
  ["done", "完了"]
];
const LEVELS = [
  ["lv1", "Lv1"],
  ["lv2", "Lv2"],
  ["lv3", "Lv3"],
  ["lv4", "Lv4"]
];

// UI state is kept in memory, mirrored to localStorage, and optionally saved through the local API.
let state = loadState();
let schedule = null;
let drag = null;
let skipClick = false;
let remoteSaveTimer = null;

const $ = (selector) => document.querySelector(selector);
const els = {};

// Bootstrap the page after the DOM exists, then load any server-side saved demo plan.
document.addEventListener("DOMContentLoaded", async () => {
  Object.assign(els, {
    metrics: $("#metrics"),
    filters: $("#filters"),
    focusList: $("#focusList"),
    status: $("#status"),
    network: $("#network"),
    edges: $("#edges"),
    nodes: $("#nodes"),
    gantt: $("#gantt"),
    taskTable: $("#taskTable"),
    inspector: $("#inspector"),
    search: $("#search"),
    addTask: $("#addTask"),
    linkMode: $("#linkMode"),
    autoLayout: $("#autoLayout"),
    resetData: $("#resetData"),
    linkSettings: $("#linkSettings"),
    relationType: $("#relationType"),
    lagDays: $("#lagDays"),
    edgeLabel: $("#edgeLabel")
  });

  bindEvents();
  await loadRemotePlan();
  render();
});

// Wire all UI controls. Most handlers update state, persist it, and re-render.
function bindEvents() {
  els.addTask.addEventListener("click", addTask);
  els.linkMode.addEventListener("click", () => {
    // Link mode makes node clicks create dependencies instead of simply selecting tasks.
    state.linkMode = !state.linkMode;
    if (!state.linkMode) state.linkSource = null;
    saveState();
    render();
  });
  els.autoLayout.addEventListener("click", () => {
    // Auto-layout keeps the current schedule but recalculates node positions.
    autoLayout();
    saveState();
    render();
    setStatus("自動整列しました");
  });
  els.resetData.addEventListener("click", () => {
    // Reset returns the browser to the built-in sample EPC plan.
    if (!window.confirm("サンプル工程に戻します。現在の編集内容は置き換わります。")) return;
    state = seedState();
    saveState();
    render();
  });
  els.search.addEventListener("input", () => {
    // Search is applied across code, name, owner, and area.
    state.search = els.search.value.trim();
    saveState();
    render();
  });
  els.relationType.addEventListener("change", () => {
    // Relation type is used by the next dependency created in link mode.
    state.relationType = els.relationType.value;
    saveState();
  });
  els.lagDays.addEventListener("change", () => {
    // Clamp lag so accidental large values do not distort the demo schedule.
    state.lagDays = clamp(parseInt(els.lagDays.value, 10), -30, 90, 0);
    els.lagDays.value = state.lagDays;
    saveState();
  });
  const syncEdgeLabel = () => {
    // The label is applied to the next dependency created or updated in link mode.
    state.edgeLabel = els.edgeLabel.value.trim().slice(0, 30);
    els.edgeLabel.value = state.edgeLabel;
    saveState();
  };
  els.edgeLabel.addEventListener("input", syncEdgeLabel);
  els.edgeLabel.addEventListener("change", syncEdgeLabel);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // The active view is persisted so refreshes keep the same working surface.
      state.view = tab.dataset.view;
      saveState();
      render();
    });
  });

  els.filters.addEventListener("click", (event) => {
    // Area filters narrow all views to the selected EPC work area.
    const addButton = event.target.closest("[data-add-area]");
    if (addButton) {
      addArea();
      return;
    }

    const deleteButton = event.target.closest("[data-delete-area]");
    if (deleteButton) {
      deleteArea(deleteButton.dataset.deleteArea);
      return;
    }

    const button = event.target.closest("[data-area]");
    if (!button) return;
    state.area = button.dataset.area;
    saveState();
    render();
  });
  els.filters.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("[data-new-area]")) {
      event.preventDefault();
      addArea();
    }
  });

  els.nodes.addEventListener("pointerdown", startDrag);
  els.nodes.addEventListener("click", (event) => {
    // Dragging a node also emits a click, so skipClick suppresses that accidental selection.
    if (skipClick) return;
    const node = event.target.closest(".node");
    if (!node) return;
    onNodeClick(node.dataset.id);
  });

  els.taskTable.addEventListener("change", onTableChange);
  els.taskTable.addEventListener("click", (event) => {
    // Selecting a table row should not interrupt native input/select interactions.
    const row = event.target.closest("[data-id]");
    if (!row) return;
    if (event.target.closest("input, select, textarea, button")) {
      state.selected = row.dataset.id;
      saveState();
      return;
    }
    state.selected = row.dataset.id;
    saveState();
    render();
  });

  els.inspector.addEventListener("change", onInspectorChange);
  els.inspector.addEventListener("input", onInspectorInput);
  els.inspector.addEventListener("click", onInspectorClick);
}

// Load the last browser-local state. Broken JSON falls back to the sample data.
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch {
    // Ignore broken localStorage state.
  }
  return seedState();
}

// Persist locally immediately and debounce the API save for local server mode.
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleRemoteSave();
}

// Load the shared demo plan from the local API when the dev server is running.
async function loadRemotePlan() {
  try {
    const res = await fetch("/api/plans/demo");
    if (!res.ok) return;
    const data = await res.json();
    if (data.plan?.tasks && data.plan?.dependencies) {
      state = normalizeState({
        ...state,
        ...data.plan,
        view: state.view || "network",
        area: state.area || "all",
        search: state.search || ""
      });
    }
  } catch {
    // Local static file mode can still run without the API server.
  }
}

// Debounced write-through save. Static hosting still works because API failures are ignored.
function scheduleRemoteSave() {
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => {
    fetch("/api/plans/demo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: state })
    }).catch(() => {
      // Keep the UI usable even if the local API is not running.
    });
  }, 250);
}

// Built-in EPC sample used for first load, reset, and GitHub Pages static demo mode.
function seedState() {
  return {
    view: "network",
    area: "all",
    search: "",
    selected: "t4",
    linkMode: false,
    linkSource: null,
    relationType: "FS",
    lagDays: 0,
    edgeLabel: "",
    areas: DEFAULT_AREAS.slice(),
    tasks: [
      task("t1", "E100", "PFD確定", "Engineering", "Process Lead", 8, 40, 78),
      task("t2", "E110", "P&ID Rev.B発行", "Engineering", "Process Lead", 14, 285, 72),
      task("t3", "E120", "HAZOPレビュー", "Engineering", "HSE Manager", 6, 535, 80),
      task("t4", "P100", "長納期機器RFQ", "Procurement", "Procurement", 10, 285, 240),
      task("t5", "P110", "ベンダー評価・発注", "Procurement", "Procurement", 12, 535, 232),
      task("t6", "F100", "圧力容器製作", "Fabrication", "Vendor A", 35, 785, 232),
      task("t7", "F110", "現地搬入", "Fabrication", "Logistics", 8, 1035, 240),
      task("t8", "C100", "造成・仮設", "Construction", "Site Civil", 18, 40, 478),
      task("t9", "C110", "基礎施工", "Construction", "Site Civil", 20, 285, 472),
      task("t10", "C120", "鉄骨建方", "Construction", "Construction", 16, 535, 478),
      task("t11", "C130", "機器据付", "Construction", "Mechanical", 12, 785, 468),
      task("t12", "C140", "配管プレファブ・取付", "Construction", "Piping Lead", 22, 1035, 470),
      task("t13", "C150", "E&I敷設・結線", "Construction", "E&I Lead", 18, 1035, 635),
      task("t14", "M100", "プレコミッショニング", "Commissioning", "Completions", 10, 785, 635),
      task("t15", "M110", "試運転開始", "Commissioning", "Commissioning", 7, 535, 635)
    ],
    dependencies: [
      dep("d1", "t1", "t2", "FS", 0),
      dep("d2", "t2", "t3", "FS", 0),
      dep("d3", "t2", "t4", "SS", 4),
      dep("d4", "t4", "t5", "FS", 0),
      dep("d5", "t5", "t6", "FS", 5),
      dep("d6", "t6", "t7", "FS", 0),
      dep("d7", "t8", "t9", "FS", 0),
      dep("d8", "t9", "t10", "FS", 2),
      dep("d9", "t10", "t11", "FS", 0),
      dep("d10", "t7", "t11", "FS", 0),
      dep("d11", "t11", "t12", "SS", 3),
      dep("d12", "t10", "t13", "FS", 0),
      dep("d13", "t12", "t14", "FS", 0),
      dep("d14", "t13", "t14", "FS", 0),
      dep("d15", "t3", "t14", "FS", 0),
      dep("d16", "t14", "t15", "FS", 0)
    ]
  };
}

// Task factory keeps seed data compact and consistent.
function task(id, code, name, area, owner, duration, x, y) {
  return normalizeTask({ id, code, name, area, owner, duration, progress: 0, x, y });
}

// Dependency factory supports FS/SS/FF/SF plus lag days.
function dep(id, from, to, type, lag, label = "") {
  return normalizeDependency({ id, from, to, type, lag, label });
}

// Main render pipeline: recalculate schedule, sync controls, then repaint every view.
function render() {
  schedule = calculateSchedule(state.tasks, state.dependencies);
  els.search.value = state.search || "";
  els.relationType.value = state.relationType || "FS";
  els.lagDays.value = state.lagDays || 0;
  els.edgeLabel.value = state.edgeLabel || "";

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === state.view);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${state.view}View`);
  });

  els.linkMode.classList.toggle("active", state.linkMode);
  els.linkMode.querySelector("span:last-child").textContent = state.linkMode ? "接続中" : "依存接続";
  els.linkSettings.classList.toggle("active", state.linkMode);

  renderMetrics();
  renderFilters();
  renderFocus();
  renderNetwork();
  renderGantt();
  renderTable();
  renderInspector();

  if (state.linkMode && state.linkSource) {
    const source = getTask(state.linkSource);
    setStatus(`接続中: ${source.code} → 後続タスクを選択`, "warn");
  } else if (state.linkMode) {
    setStatus("接続中: 先行タスクを選択", "warn");
  } else if (getTask(state.selected)) {
    const selected = getTask(state.selected);
    setStatus(`選択: ${selected.code} ${selected.name}`);
  } else {
    setStatus("待機中");
  }
}

// Render summary cards for project duration, task count, dependency count, and critical count.
function renderMetrics() {
  const criticalCount = [...schedule.items.values()].filter((item) => item.critical).length;
  const delayCount = state.tasks.filter((taskItem) => computeTaskStatus(taskItem).severity === "late").length;
  const metrics = [
    [`${schedule.duration}日`, "計算工期"],
    [state.tasks.length, "タスク"],
    [state.dependencies.length, "依存線"],
    [criticalCount, "クリティカル"],
    [delayCount, "日程注意"]
  ];

  els.metrics.innerHTML = metrics
    .map(([value, label]) => `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`)
    .join("");
}

// Render area filter buttons and their task counts.
function renderFilters() {
  const areas = getAreas();
  const buttons = [
    ["all", "すべて", state.tasks.length],
    ...areas.map((area) => [area, area, state.tasks.filter((taskItem) => taskItem.area === area).length])
  ];

  els.filters.innerHTML = `
    <div class="filter-chips">
      ${buttons.map(([area, label, count]) => `
      <button class="chip ${state.area === area ? "active" : ""}" data-area="${area}">
        <span><span class="area-swatch" style="background:${area === "all" ? "#aab4ad" : areaColor(area)}"></span>${escapeHtml(label)}</span>
        <span class="badge">${count}</span>
      </button>
      `).join("")}
    </div>
    <div class="area-manager">
      <input data-new-area type="text" maxlength="24" placeholder="所属/領域を追加">
      <button type="button" data-add-area>追加</button>
    </div>
    <div class="area-master">
      ${areas.map((area) => {
        const used = state.tasks.some((taskItem) => taskItem.area === area);
        const fixed = DEFAULT_AREAS.includes(area);
        return `
          <div class="area-row">
            <span><span class="area-swatch" style="background:${areaColor(area)}"></span>${escapeHtml(area)}</span>
            <button type="button" data-delete-area="${escapeAttr(area)}" ${used || fixed ? "disabled" : ""}>削除</button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// Render short list of tasks that need attention because they are critical or low-float.
function renderFocus() {
  const items = state.tasks
    .map((taskItem) => ({ task: taskItem, data: schedule.items.get(taskItem.id) }))
    .map((item) => ({ ...item, timing: computeTaskStatus(item.task) }))
    .filter((item) => item.timing.severity === "late" || item.data?.critical || item.data?.float <= 3)
    .sort((a, b) => (a.timing.severity === "late" ? -1 : 0) - (b.timing.severity === "late" ? -1 : 0) || a.data.float - b.data.float)
    .slice(0, 5);

  els.focusList.innerHTML = items
    .map(({ task: taskItem, data, timing }) => `
      <button class="focus-item" data-id="${taskItem.id}">
        <strong>${escapeHtml(taskItem.code)} ${escapeHtml(taskItem.name)}</strong>
        <span>${timing.severity === "late" ? timing.label : data.critical ? "Critical" : `Float ${Math.round(data.float)}日`} · ${escapeHtml(taskItem.owner || "-")}</span>
      </button>
    `)
    .join("");

  els.focusList.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selected = button.dataset.id;
      saveState();
      render();
    });
  });
}

// Render the dependency network nodes and their SVG edges.
function renderNetwork() {
  const visible = visibleTasks();
  const visibleIds = new Set(visible.map((taskItem) => taskItem.id));
  renderEdges(visibleIds);

  els.nodes.innerHTML = visible
    .map((taskItem) => {
      const data = schedule.items.get(taskItem.id);
      const timing = computeTaskStatus(taskItem);
      return `
        <article class="node ${taskItem.id === state.selected ? "selected" : ""} ${data.critical ? "critical" : ""} ${taskItem.id === state.linkSource ? "link-source" : ""}"
          data-id="${taskItem.id}" style="left:${taskItem.x}px;top:${taskItem.y}px;--area-color:${areaColor(taskItem.area)}">
          <div class="node-head">
            <span class="node-code">${escapeHtml(taskItem.code)}</span>
            <span class="node-area">${escapeHtml(taskItem.area)}</span>
          </div>
          <div class="node-name">${escapeHtml(taskItem.name)}</div>
          <div class="node-tags">
            <span class="status-badge ${timing.key}">${escapeHtml(timing.label)}</span>
            <span class="level-chip">${escapeHtml(levelLabel(taskItem.level))}</span>
          </div>
          <div class="node-meta">
            <span>${taskItem.duration}日</span>
            <span>${data.critical ? "Critical" : `Float ${Math.round(data.float)}日`}</span>
          </div>
          <div class="progress"><span style="width:${taskItem.progress}%"></span></div>
        </article>
      `;
    })
    .join("");
}

// Draw dependency edges with spread ports so multiple links do not fully overlap.
function renderEdges(visibleIds) {
  const map = new Map(state.tasks.map((taskItem) => [taskItem.id, taskItem]));
  const width = 1350;
  const height = 820;
  els.edges.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const defs = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#708079"></path>
      </marker>
      <marker id="arrowCritical" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#b74645"></path>
      </marker>
    </defs>
  `;

  const visibleDeps = state.dependencies.filter((item) => visibleIds.has(item.from) && visibleIds.has(item.to));
  const portMeta = buildEdgePortMeta(visibleDeps);

  const paths = visibleDeps
    .map((item, index) => {
      // Route from the right side for forward links and the left side for backward links.
      const from = map.get(item.from);
      const to = map.get(item.to);
      const fromData = schedule.items.get(item.from);
      const toData = schedule.items.get(item.to);
      const meta = portMeta.get(item.id);
      const forward = to.x >= from.x;
      const x1 = forward ? from.x + NODE_W : from.x;
      const x2 = forward ? to.x : to.x + NODE_W;
      const y1 = from.y + NODE_H / 2 + meta.fromOffset;
      const y2 = to.y + NODE_H / 2 + meta.toOffset;
      const direction = forward ? 1 : -1;
      const routeOffset = ((index % 7) - 3) * 18;
      const distanceX = Math.abs(x2 - x1);
      // Reduce bend on short edges; otherwise adjacent nodes can produce noisy loops.
      const bend = routeOffset * Math.min(1, distanceX / 220);
      const dx = Math.max(28, Math.min(110, distanceX * 0.42));
      const c1x = x1 + direction * dx;
      const c2x = x2 - direction * dx;
      const c1y = y1 + bend;
      const c2y = y2 - bend;
      const critical = fromData.critical && toData.critical && Math.abs(toData.es - (fromData.es + dependencyOffset(item, from, to))) < 0.001;
      const label = dependencyLabel(item);
      const labelX = (x1 + x2) / 2;
      const labelY = (y1 + y2) / 2 + bend * 0.45 - 8;

      return `
        <path class="edge ${critical ? "critical" : ""}" d="M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}" marker-end="url(#${critical ? "arrowCritical" : "arrow"})"></path>
        <text class="edge-label" x="${labelX}" y="${labelY}">${escapeHtml(label)}</text>
      `;
    })
    .join("");

  els.edges.innerHTML = defs + paths;
}

// Compute vertical offsets for each edge endpoint so fan-in/fan-out links are distinguishable.
function buildEdgePortMeta(dependencies) {
  const outgoing = new Map();
  const incoming = new Map();

  dependencies.forEach((item) => {
    if (!outgoing.has(item.from)) outgoing.set(item.from, []);
    if (!incoming.has(item.to)) incoming.set(item.to, []);
    outgoing.get(item.from).push(item);
    incoming.get(item.to).push(item);
  });

  const meta = new Map();
  outgoing.forEach((items) => {
    // Outgoing ports are ordered by target vertical position.
    const sorted = items.slice().sort((a, b) => {
      const aTarget = getTask(a.to);
      const bTarget = getTask(b.to);
      return (aTarget?.y || 0) - (bTarget?.y || 0);
    });
    sorted.forEach((item, index) => {
      const spread = (index - (sorted.length - 1) / 2) * 18;
      meta.set(item.id, { ...(meta.get(item.id) || {}), fromOffset: spread });
    });
  });

  incoming.forEach((items) => {
    // Incoming ports are ordered by source vertical position.
    const sorted = items.slice().sort((a, b) => {
      const aSource = getTask(a.from);
      const bSource = getTask(b.from);
      return (aSource?.y || 0) - (bSource?.y || 0);
    });
    sorted.forEach((item, index) => {
      const spread = (index - (sorted.length - 1) / 2) * 18;
      meta.set(item.id, { ...(meta.get(item.id) || {}), toOffset: spread });
    });
  });

  dependencies.forEach((item) => {
    meta.set(item.id, {
      fromOffset: 0,
      toOffset: 0,
      ...(meta.get(item.id) || {})
    });
  });

  return meta;
}

// Render a simple calculated Gantt chart from earliest start and task duration.
function renderGantt() {
  const tasks = visibleTasks().slice().sort((a, b) => schedule.items.get(a.id).es - schedule.items.get(b.id).es);
  const days = Math.max(42, schedule.duration + 14);
  const timelineWidth = days * DAY_W;
  const ticks = [];

  for (let day = 0; day <= days; day += 7) {
    ticks.push(`<div class="tick" style="left:${day * DAY_W}px"><span>D+${day}</span></div>`);
  }

  els.gantt.innerHTML = `
    <div class="gantt-chart" style="width:${timelineWidth + 300}px">
      <div class="gantt-head">
        <div class="gantt-label"><strong>タスク</strong></div>
        <div class="gantt-scale" style="width:${timelineWidth}px">${ticks.join("")}</div>
      </div>
      ${tasks.map((taskItem) => {
        const data = schedule.items.get(taskItem.id);
        const timing = computeTaskStatus(taskItem);
        return `
          <div class="gantt-row">
            <div class="gantt-label">
              <strong>${escapeHtml(taskItem.code)} ${escapeHtml(taskItem.name)}</strong>
              <span>${escapeHtml(taskItem.area)} · ${escapeHtml(taskItem.owner || "-")} · ${escapeHtml(timing.label)}</span>
            </div>
            <div class="gantt-line" style="width:${timelineWidth}px">
              <div class="bar ${data.critical ? "critical" : ""}" style="left:${data.es * DAY_W}px;width:${taskItem.duration * DAY_W}px"></div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// Render editable table rows. Change events update the same task state used by all views.
function renderTable() {
  els.taskTable.innerHTML = visibleTasks()
    .map((taskItem) => {
      const data = schedule.items.get(taskItem.id);
      return `
        <tr class="${taskItem.id === state.selected ? "selected" : ""}" data-id="${taskItem.id}">
          <td><input data-field="code" value="${escapeAttr(taskItem.code)}"></td>
          <td><input data-field="name" value="${escapeAttr(taskItem.name)}"></td>
          <td><select data-field="area">${getAreas().map((area) => `<option ${area === taskItem.area ? "selected" : ""}>${escapeHtml(area)}</option>`).join("")}</select></td>
          <td><select data-field="status">${STATUSES.map(([value, label]) => `<option value="${value}" ${value === taskItem.status ? "selected" : ""}>${label}</option>`).join("")}</select></td>
          <td><select data-field="level">${LEVELS.map(([value, label]) => `<option value="${value}" ${value === taskItem.level ? "selected" : ""}>${label}</option>`).join("")}</select></td>
          <td><input data-field="duration" type="number" min="1" value="${taskItem.duration}"></td>
          <td><input data-field="progress" type="number" min="0" max="100" value="${taskItem.progress}"></td>
          <td><input data-field="plannedEnd" type="date" value="${escapeAttr(taskItem.plannedEnd || "")}"></td>
          <td>${predecessorSummaries(taskItem.id).join(", ") || "-"}</td>
          <td>${data.critical ? "Critical" : `${Math.round(data.float)}日`}</td>
        </tr>
      `;
    })
    .join("");
}

// Render the detail editor for the currently selected task.
function renderInspector() {
  const selected = getTask(state.selected);
  if (!selected) {
    els.inspector.innerHTML = `<section><div class="eyebrow">詳細</div><p>タスクを選択</p></section>`;
    return;
  }

  const data = schedule.items.get(selected.id);
  const timing = computeTaskStatus(selected);
  els.inspector.innerHTML = `
    <section>
      <div class="eyebrow">詳細</div>
      <h2>${escapeHtml(selected.code)} ${escapeHtml(selected.name)}</h2>
      <p class="note ${timing.severity}">${escapeHtml(timing.label)} · ${data.critical ? "クリティカルタスク" : `余裕 ${Math.round(data.float)}日`}</p>
      <div class="field-grid">
        <label class="wide">タスク名
          <input data-inspector="name" value="${escapeAttr(selected.name)}">
        </label>
        <label>コード
          <input data-inspector="code" value="${escapeAttr(selected.code)}">
        </label>
        <label>領域
          <select data-inspector="area">${getAreas().map((area) => `<option ${area === selected.area ? "selected" : ""}>${escapeHtml(area)}</option>`).join("")}</select>
        </label>
        <label>状態
          <select data-inspector="status">${STATUSES.map(([value, label]) => `<option value="${value}" ${value === selected.status ? "selected" : ""}>${label}</option>`).join("")}</select>
        </label>
        <label>レベル
          <select data-inspector="level">${LEVELS.map(([value, label]) => `<option value="${value}" ${value === selected.level ? "selected" : ""}>${label}</option>`).join("")}</select>
        </label>
        <label>担当
          <input data-inspector="owner" value="${escapeAttr(selected.owner)}">
        </label>
        <label>期間
          <input data-inspector="duration" type="number" min="1" value="${selected.duration}">
        </label>
        <label>進捗
          <input data-inspector="progress" type="number" min="0" max="100" value="${selected.progress}">
        </label>
        <label>予定開始
          <input data-inspector="plannedStart" type="date" value="${escapeAttr(selected.plannedStart || "")}">
        </label>
        <label>予定完了
          <input data-inspector="plannedEnd" type="date" value="${escapeAttr(selected.plannedEnd || "")}">
        </label>
        <label>実績開始
          <input data-inspector="actualStart" type="date" value="${escapeAttr(selected.actualStart || "")}">
        </label>
        <label>実績完了
          <input data-inspector="actualEnd" type="date" value="${escapeAttr(selected.actualEnd || "")}">
        </label>
        <label class="wide">説明・メモ
          <textarea data-inspector="description" rows="4" maxlength="300">${escapeHtml(selected.description || "")}</textarea>
        </label>
      </div>
      ${renderDependencyEditor(selected.id)}
    </section>
  `;
}

// Handle a network node click: select normally, or create/update a dependency in link mode.
function onNodeClick(id) {
  if (!state.linkMode) {
    state.selected = id;
    saveState();
    render();
    return;
  }

  if (!state.linkSource || state.linkSource === id) {
    state.linkSource = state.linkSource === id ? null : id;
    state.selected = id;
    saveState();
    render();
    return;
  }

  const nextDeps = [
    ...state.dependencies,
    dep(`d${Date.now()}`, state.linkSource, id, state.relationType, clamp(parseInt(state.lagDays, 10), -30, 90, 0), state.edgeLabel)
  ];

  if (hasCycle(state.tasks, nextDeps)) {
    // Reject cycles immediately so the schedule calculation remains a DAG.
    setStatus("循環依存になるため接続できません", "error");
    return;
  }

  const existing = state.dependencies.find((item) => item.from === state.linkSource && item.to === id);
  if (existing) {
    existing.type = state.relationType;
    existing.lag = state.lagDays;
    existing.label = state.edgeLabel;
  } else {
    state.dependencies = nextDeps;
  }

  state.selected = id;
  saveState();
  render();
}

// Start dragging a task node in the network view.
function startDrag(event) {
  const node = event.target.closest(".node");
  if (!node || state.linkMode) return;
  const taskItem = getTask(node.dataset.id);
  drag = {
    id: taskItem.id,
    node,
    sx: event.clientX,
    sy: event.clientY,
    ox: taskItem.x,
    oy: taskItem.y,
    moved: false
  };
  node.setPointerCapture(event.pointerId);
  document.addEventListener("pointermove", moveDrag);
  document.addEventListener("pointerup", endDrag, { once: true });
}

// Move the dragged node and redraw only the SVG edges for responsive feedback.
function moveDrag(event) {
  if (!drag) return;
  const taskItem = getTask(drag.id);
  const dx = event.clientX - drag.sx;
  const dy = event.clientY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  taskItem.x = clamp(drag.ox + dx, 8, 1150, drag.ox);
  taskItem.y = clamp(drag.oy + dy, 8, 700, drag.oy);
  drag.node.style.left = `${taskItem.x}px`;
  drag.node.style.top = `${taskItem.y}px`;
  renderEdges(new Set(visibleTasks().map((task) => task.id)));
}

// Finish node dragging, persist the new position, and suppress the following synthetic click.
function endDrag() {
  if (drag?.moved) {
    skipClick = true;
    setTimeout(() => {
      skipClick = false;
    }, 0);
    saveState();
  }
  document.removeEventListener("pointermove", moveDrag);
  drag = null;
}

// Apply changes made in the table view.
function onTableChange(event) {
  const row = event.target.closest("[data-id]");
  if (!row || !event.target.dataset.field) return;
  updateTask(row.dataset.id, event.target.dataset.field, event.target.value);
}

// Apply changes made in the inspector panel.
function onInspectorChange(event) {
  const depField = event.target.dataset.dependencyField;
  if (depField) {
    updateDependency(event.target.closest("[data-dependency-id]")?.dataset.dependencyId, depField, event.target.value);
    return;
  }

  const field = event.target.dataset.inspector;
  if (!field) return;
  updateTask(state.selected, field, event.target.value);
}

// Save free-form notes while typing without re-rendering and stealing the cursor.
function onInspectorInput(event) {
  if (event.target.dataset.inspector !== "description") return;
  const taskItem = getTask(state.selected);
  if (!taskItem) return;
  taskItem.description = event.target.value.trim().slice(0, 300);
  saveState();
}

// Handle dependency deletion from the selected task detail panel.
function onInspectorClick(event) {
  const deleteButton = event.target.closest("[data-delete-dependency]");
  if (!deleteButton) return;
  state.dependencies = state.dependencies.filter((item) => item.id !== deleteButton.dataset.deleteDependency);
  saveState();
  render();
}

// Update a single task field and re-render all dependent views.
function updateTask(id, field, value) {
  const taskItem = getTask(id);
  if (!taskItem) return;
  if (field === "duration") taskItem.duration = clamp(parseInt(value, 10), 1, 365, taskItem.duration);
  else if (field === "progress") taskItem.progress = clamp(parseInt(value, 10), 0, 100, taskItem.progress);
  else if (field === "status") taskItem.status = statusValues().includes(value) ? value : taskItem.status;
  else if (field === "level") taskItem.level = levelValues().includes(value) ? value : taskItem.level;
  else if (["plannedStart", "plannedEnd", "actualStart", "actualEnd"].includes(field)) taskItem[field] = normalizeDate(value);
  else if (field === "description") taskItem.description = String(value).trim().slice(0, 300);
  else taskItem[field] = String(value).trim() || taskItem[field];
  if (field === "area" && !state.areas.includes(taskItem.area)) state.areas.push(taskItem.area);
  state.selected = id;
  saveState();
  render();
}

// Update one dependency from the detail panel without changing its endpoints.
function updateDependency(id, field, value) {
  const item = state.dependencies.find((depItem) => depItem.id === id);
  if (!item) return;
  if (field === "type") item.type = RELATIONS.includes(value) ? value : item.type;
  else if (field === "lag") item.lag = clamp(parseInt(value, 10), -30, 90, item.lag);
  else if (field === "label") item.label = String(value).trim().slice(0, 30);
  saveState();
  render();
}

// Add a new task in the current area filter, then select it for editing.
function addTask() {
  const id = `t${Date.now()}`;
  const taskItem = task(id, `N${state.tasks.length + 1}`, "新規タスク", state.area === "all" ? getAreas()[0] : state.area, "", 5, 80, 120);
  state.tasks.push(taskItem);
  state.selected = id;
  saveState();
  render();
}

// Place tasks in area lanes based on calculated earliest start.
function autoLayout() {
  const byArea = new Map();
  const areas = getAreas();
  const sorted = state.tasks.slice().sort((a, b) => schedule.items.get(a.id).es - schedule.items.get(b.id).es);
  sorted.forEach((taskItem) => {
    const lane = byArea.get(taskItem.area) || 0;
    byArea.set(taskItem.area, lane + 1);
    const areaIndex = Math.max(0, areas.indexOf(taskItem.area));
    taskItem.x = 40 + Math.min(5, Math.floor(schedule.items.get(taskItem.id).es / 20)) * 235;
    taskItem.y = 70 + areaIndex * 145 + (lane % 2) * 24;
  });
}

// Calculate CPM-style earliest/latest dates, total duration, float, and critical flags.
function calculateSchedule(tasks, dependencies) {
  const map = new Map(tasks.map((taskItem) => [taskItem.id, taskItem]));
  const items = new Map(tasks.map((taskItem) => [taskItem.id, { es: 0, ef: taskItem.duration, ls: 0, lf: 0, float: 0, critical: false }]));
  const outgoing = new Map(tasks.map((taskItem) => [taskItem.id, []]));
  const indegree = new Map(tasks.map((taskItem) => [taskItem.id, 0]));

  for (const item of dependencies) {
    // Build adjacency and indegree for topological traversal.
    if (!map.has(item.from) || !map.has(item.to)) continue;
    outgoing.get(item.from).push(item);
    indegree.set(item.to, indegree.get(item.to) + 1);
  }

  const queue = tasks.filter((taskItem) => indegree.get(taskItem.id) === 0).map((taskItem) => taskItem.id);
  const topo = [];
  while (queue.length) {
    // Kahn topological sort gives safe forward/backward schedule order.
    const id = queue.shift();
    topo.push(id);
    for (const item of outgoing.get(id)) {
      indegree.set(item.to, indegree.get(item.to) - 1);
      if (indegree.get(item.to) === 0) queue.push(item.to);
    }
  }

  for (const id of topo) {
    // Forward pass: earliest start is constrained by predecessor relation offsets.
    const from = map.get(id);
    const fromItem = items.get(id);
    fromItem.ef = fromItem.es + from.duration;
    for (const item of outgoing.get(id)) {
      const to = map.get(item.to);
      const toItem = items.get(item.to);
      toItem.es = Math.max(toItem.es, fromItem.es + dependencyOffset(item, from, to));
    }
  }

  for (const taskItem of tasks) {
    // Normalize earliest finish after all starts are known.
    const item = items.get(taskItem.id);
    item.ef = item.es + taskItem.duration;
  }

  const duration = Math.max(0, ...[...items.values()].map((item) => item.ef));

  for (const taskItem of tasks) {
    // Initialize backward pass from project finish.
    const item = items.get(taskItem.id);
    item.ls = duration - taskItem.duration;
    item.lf = duration;
  }

  for (const id of topo.slice().reverse()) {
    // Backward pass: latest start is constrained by successor latest starts.
    const from = map.get(id);
    const fromItem = items.get(id);
    for (const item of outgoing.get(id)) {
      const to = map.get(item.to);
      const toItem = items.get(item.to);
      fromItem.ls = Math.min(fromItem.ls, toItem.ls - dependencyOffset(item, from, to));
    }
    fromItem.lf = fromItem.ls + from.duration;
    fromItem.float = fromItem.ls - fromItem.es;
    fromItem.critical = fromItem.float <= 0.001;
  }

  return { items, duration };
}

// Convert FS/SS/FF/SF dependency semantics into a start-to-start offset.
function dependencyOffset(item, from, to) {
  const lag = Number(item.lag) || 0;
  if (item.type === "SS") return lag;
  if (item.type === "FF") return from.duration + lag - to.duration;
  if (item.type === "SF") return lag - to.duration;
  return from.duration + lag;
}

// Detect cycles before accepting new dependencies.
function hasCycle(tasks, dependencies) {
  const ids = new Set(tasks.map((taskItem) => taskItem.id));
  const outgoing = new Map(tasks.map((taskItem) => [taskItem.id, []]));
  const indegree = new Map(tasks.map((taskItem) => [taskItem.id, 0]));
  dependencies.forEach((item) => {
    // Ignore orphan dependencies defensively.
    if (!ids.has(item.from) || !ids.has(item.to)) return;
    outgoing.get(item.from).push(item.to);
    indegree.set(item.to, indegree.get(item.to) + 1);
  });
  const queue = tasks.filter((taskItem) => indegree.get(taskItem.id) === 0).map((taskItem) => taskItem.id);
  let visited = 0;
  while (queue.length) {
    // If every task cannot be visited, a cycle remains.
    const id = queue.shift();
    visited += 1;
    outgoing.get(id).forEach((to) => {
      indegree.set(to, indegree.get(to) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    });
  }
  return visited !== tasks.length;
}

// Apply current area and text filters.
function visibleTasks() {
  const q = (state.search || "").toLowerCase();
  return state.tasks.filter((taskItem) => {
    const areaOk = state.area === "all" || taskItem.area === state.area;
    const text = `${taskItem.code} ${taskItem.name} ${taskItem.owner} ${taskItem.area} ${taskItem.description} ${taskItem.status} ${taskItem.level}`.toLowerCase();
    return areaOk && (!q || text.includes(q));
  });
}

// Return predecessor summaries for table display.
function predecessorSummaries(id) {
  return state.dependencies
    .filter((item) => item.to === id)
    .map((item) => {
      const source = getTask(item.from);
      return source ? `${source.code} ${dependencyLabel(item)}` : "";
    })
    .filter(Boolean);
}

// Find a task by id.
function getTask(id) {
  return state.tasks.find((taskItem) => taskItem.id === id);
}

// Normalize loaded data so older localStorage/JSON plans keep working after schema additions.
function normalizeState(raw) {
  if (!raw || !Array.isArray(raw.tasks) || !Array.isArray(raw.dependencies)) return seedState();
  const tasks = raw.tasks.map(normalizeTask);
  const taskAreas = tasks.map((taskItem) => taskItem.area).filter(Boolean);
  const areas = unique([...(Array.isArray(raw.areas) ? raw.areas : []), ...DEFAULT_AREAS, ...taskAreas]);
  const area = raw.area === "all" || areas.includes(raw.area) ? raw.area : "all";

  return {
    ...raw,
    view: ["network", "gantt", "table"].includes(raw.view) ? raw.view : "network",
    area,
    search: raw.search || "",
    selected: tasks.some((taskItem) => taskItem.id === raw.selected) ? raw.selected : tasks[0]?.id,
    linkMode: Boolean(raw.linkMode),
    linkSource: raw.linkSource || null,
    relationType: RELATIONS.includes(raw.relationType) ? raw.relationType : "FS",
    lagDays: clamp(parseInt(raw.lagDays, 10), -30, 90, 0),
    edgeLabel: String(raw.edgeLabel || "").slice(0, 30),
    areas,
    tasks,
    dependencies: raw.dependencies.map(normalizeDependency)
  };
}

// Fill missing task fields introduced after the original MVP.
function normalizeTask(raw) {
  const area = String(raw.area || DEFAULT_AREAS[0]).trim() || DEFAULT_AREAS[0];
  return {
    id: String(raw.id || `t${Date.now()}`),
    code: String(raw.code || "N").trim() || "N",
    name: String(raw.name || "新規タスク").trim() || "新規タスク",
    area,
    owner: String(raw.owner || "").trim(),
    duration: clamp(parseInt(raw.duration, 10), 1, 365, 5),
    progress: clamp(parseInt(raw.progress, 10), 0, 100, 0),
    description: String(raw.description || "").trim().slice(0, 300),
    status: statusValues().includes(raw.status) ? raw.status : "todo",
    level: levelValues().includes(raw.level) ? raw.level : "lv4",
    plannedStart: normalizeDate(raw.plannedStart),
    plannedEnd: normalizeDate(raw.plannedEnd),
    actualStart: normalizeDate(raw.actualStart),
    actualEnd: normalizeDate(raw.actualEnd),
    x: clamp(parseInt(raw.x, 10), 8, 1150, 80),
    y: clamp(parseInt(raw.y, 10), 8, 700, 120)
  };
}

// Fill missing dependency fields introduced after the original MVP.
function normalizeDependency(raw) {
  return {
    id: String(raw.id || `d${Date.now()}`),
    from: String(raw.from || ""),
    to: String(raw.to || ""),
    type: RELATIONS.includes(raw.type) ? raw.type : "FS",
    lag: clamp(parseInt(raw.lag, 10), -30, 90, 0),
    label: String(raw.label || "").trim().slice(0, 30)
  };
}

// Render dependency rows connected from the selected task.
function renderDependencyEditor(taskId) {
  const outgoing = state.dependencies.filter((item) => item.from === taskId);
  if (!outgoing.length) {
    return `<div class="dependency-editor"><h3>後続依存</h3><p class="note">接続モードで後続タスクを選ぶと追加できます。</p></div>`;
  }

  return `
    <div class="dependency-editor">
      <h3>後続依存</h3>
      ${outgoing.map((item) => {
        const target = getTask(item.to);
        return `
          <div class="dependency-row" data-dependency-id="${escapeAttr(item.id)}">
            <strong>→ ${escapeHtml(target ? `${target.code} ${target.name}` : item.to)}</strong>
            <select data-dependency-field="type">${RELATIONS.map((type) => `<option value="${type}" ${type === item.type ? "selected" : ""}>${type}</option>`).join("")}</select>
            <input data-dependency-field="lag" type="number" min="-30" max="90" value="${item.lag}">
            <input data-dependency-field="label" maxlength="30" placeholder="ラベル" value="${escapeAttr(item.label || "")}">
            <button type="button" data-delete-dependency="${escapeAttr(item.id)}">削除</button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// Add a custom affiliation/area used by filters and task editors.
function addArea() {
  const input = els.filters.querySelector("[data-new-area]");
  const value = input?.value.trim().slice(0, 24);
  if (!value) return;
  if (!state.areas.includes(value)) state.areas.push(value);
  state.area = value;
  saveState();
  render();
}

// Remove an unused custom affiliation/area.
function deleteArea(area) {
  if (DEFAULT_AREAS.includes(area) || state.tasks.some((taskItem) => taskItem.area === area)) return;
  state.areas = state.areas.filter((item) => item !== area);
  if (state.area === area) state.area = "all";
  saveState();
  render();
}

// Return all known affiliations/areas in a stable display order.
function getAreas() {
  return unique([...(state.areas || []), ...DEFAULT_AREAS, ...state.tasks.map((taskItem) => taskItem.area)]);
}

// Pick a consistent visual color for an affiliation/area.
function areaColor(area) {
  const areas = getAreas();
  const index = Math.max(0, areas.indexOf(area));
  return AREA_COLORS[index % AREA_COLORS.length];
}

// Build the compact edge label shown on SVG lines and predecessor cells.
function dependencyLabel(item) {
  const lag = item.lag ? item.lag > 0 ? `+${item.lag}` : item.lag : "";
  return `${item.type}${lag}${item.label ? ` · ${item.label}` : ""}`;
}

// Compute display status, including simple planned/actual date delay flags.
function computeTaskStatus(taskItem) {
  const today = todayText();
  if (taskItem.status === "done") return { key: "done", label: "完了", severity: "ok" };
  if (taskItem.status === "doing" && taskItem.plannedEnd && taskItem.plannedEnd < today) {
    return { key: "delayEnd", label: "終了遅延", severity: "late" };
  }
  if (taskItem.status === "todo" && taskItem.plannedStart && taskItem.plannedStart < today) {
    return { key: "delayStart", label: "開始遅延", severity: "late" };
  }
  return { key: taskItem.status, label: statusLabel(taskItem.status), severity: "normal" };
}

function statusLabel(status) {
  return STATUSES.find(([value]) => value === status)?.[1] || "未着手";
}

function levelLabel(level) {
  return LEVELS.find(([value]) => value === level)?.[1] || "Lv4";
}

function statusValues() {
  return STATUSES.map(([value]) => value);
}

function levelValues() {
  return LEVELS.map(([value]) => value);
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function todayText() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function unique(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

// Update the status bar text and severity class.
function setStatus(text, type = "") {
  els.status.textContent = text;
  els.status.className = `status ${type}`.trim();
}

// Clamp numeric input and use fallback for invalid values.
function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

// Escape text before injecting it into HTML templates.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Attribute escaping is currently the same as HTML escaping.
function escapeAttr(value) {
  return escapeHtml(value);
}
