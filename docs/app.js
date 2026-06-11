// ブラウザ保存キー、描画サイズ、工程計算で使う基本定数をまとめています。
const STORAGE_KEY = "e-relations-gui-v1";
const NODE_SIZES = {
  standard: { width: 196, height: 132, rowGap: 34 },
  compact: { width: 168, height: 96, rowGap: 24 }
};

// ネットワークビューの最小サイズと、自動整列時の余白/列間隔です。
const NETWORK_MIN_W = 1350;
const NETWORK_MIN_H = 820;
const LAYOUT_MARGIN_X = 48;
const LAYOUT_MARGIN_Y = 54;
const LAYOUT_COL_W = 245;
const LAYOUT_AREA_GAP = 68;
const DAY_W = 18;

// EPCでよく使う領域、表示色、依存種別、ステータス、レベルのマスターです。
const DEFAULT_AREAS = ["Engineering", "Procurement", "Fabrication", "Construction", "Commissioning"];
const AREA_COLORS = ["#1a73e8", "#188038", "#f29900", "#9334e6", "#d93025", "#00796b", "#5f6368"];
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

// 画面状態はメモリで持ち、localStorageとローカルAPIにも保存します。
let state = loadState();
let schedule = null;
let drag = null;
let skipClick = false;
let remoteSaveTimer = null;
let networkBounds = { width: NETWORK_MIN_W, height: NETWORK_MIN_H };

// DOM参照を短く書くためのヘルパーと、初期化後に埋める要素キャッシュです。
const $ = (selector) => document.querySelector(selector);
const els = {};

// DOM生成後に画面を初期化し、ローカルAPIに保存済みのデモ工程があれば読み込みます。
document.addEventListener("DOMContentLoaded", async () => {
  Object.assign(els, {
    metrics: $("#metrics"),
    filters: $("#filters"),
    focusList: $("#focusList"),
    status: $("#status"),
    network: $("#network"),
    areaBands: $("#areaBands"),
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
    edgeLabel: $("#edgeLabel"),
    networkView: $("#networkView"),
    focusSelected: $("#focusSelected"),
    densityButtons: [...document.querySelectorAll("[data-density]")]
  });

  bindEvents();
  await loadRemotePlan();
  render();
});

// すべての操作イベントを登録します。多くの処理は状態更新、保存、再描画の順で動きます。
function bindEvents() {
  els.addTask.addEventListener("click", addTask);
  els.linkMode.addEventListener("click", () => {
    // 依存接続モードでは、ノードクリックを「選択」ではなく「依存線作成」に使います。
    state.linkMode = !state.linkMode;
    if (!state.linkMode) state.linkSource = null;
    saveState();
    render();
  });
  els.autoLayout.addEventListener("click", () => {
    // 自動整列は工程データを変えず、ノードの表示位置だけを再計算します。
    autoLayout();
    saveState();
    render();
    setStatus("重なりを避けて自動整列しました");
  });
  els.resetData.addEventListener("click", () => {
    // 初期化では、ブラウザ上の編集内容を内蔵サンプル工程へ戻します。
    if (!window.confirm("サンプル工程に戻します。現在の編集内容は置き換わります。")) return;
    state = seedState();
    saveState();
    render();
  });
  els.search.addEventListener("input", () => {
    // 検索はコード、タスク名、担当、領域をまとめて対象にします。
    state.search = els.search.value.trim();
    saveState();
    render();
  });
  els.relationType.addEventListener("change", () => {
    // 依存種別は、次に接続モードで作る依存線へ適用します。
    state.relationType = els.relationType.value;
    saveState();
  });
  els.lagDays.addEventListener("change", () => {
    // ラグは範囲内に丸め、誤入力で工程全体が大きく崩れないようにします。
    state.lagDays = clamp(parseInt(els.lagDays.value, 10), -30, 90, 0);
    els.lagDays.value = state.lagDays;
    saveState();
  });
  const syncEdgeLabel = () => {
    // 線ラベルは、次に作成または更新する依存線へ適用します。
    state.edgeLabel = els.edgeLabel.value.trim().slice(0, 30);
    els.edgeLabel.value = state.edgeLabel;
    saveState();
  };
  els.edgeLabel.addEventListener("input", syncEdgeLabel);
  els.edgeLabel.addEventListener("change", syncEdgeLabel);
  els.focusSelected.addEventListener("click", focusSelectedTask);
  els.densityButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.networkDensity = button.dataset.density === "compact" ? "compact" : "standard";
      saveState();
      render();
      setStatus(state.networkDensity === "compact" ? "コンパクト表示にしました" : "標準表示にしました");
    });
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // 表示中のビューは保存し、再読み込み後も同じ作業面から再開できるようにします。
      state.view = tab.dataset.view;
      saveState();
      render();
    });
  });

  els.filters.addEventListener("click", (event) => {
    // 領域フィルターは、ネットワーク、ガント、表すべての表示対象を絞り込みます。
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

    const criticalButton = event.target.closest("[data-critical-only]");
    if (criticalButton) {
      state.criticalOnly = !state.criticalOnly;
      saveState();
      render();
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
  els.edges.addEventListener("click", onEdgeClick);
  els.nodes.addEventListener("click", (event) => {
    // ドラッグ後にもclickが発火するため、意図しない選択変更をskipClickで抑止します。
    if (skipClick) return;
    const node = event.target.closest(".node");
    if (!node) return;
    onNodeClick(node.dataset.id);
  });

  els.taskTable.addEventListener("change", onTableChange);
  els.taskTable.addEventListener("click", (event) => {
    // 表の入力欄やセレクト操作中は、行選択が編集操作を邪魔しないようにします。
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

// ブラウザに保存された直近状態を読み込みます。壊れたJSONならサンプルへ戻します。
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch {
    // 壊れたlocalStorageは無視して、初期データで続行します。
  }
  return seedState();
}

// localStorageへ即時保存し、ローカルAPIへの保存は短時間まとめて実行します。
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleRemoteSave();
}

// 開発サーバーが動いている場合は、共有デモ工程をローカルAPIから読み込みます。
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
    // 静的ファイルとして開いた場合も、APIなしで画面だけは使えるようにします。
  }
}

// API保存は連続入力をまとめて送ります。静的ホスティングでは失敗しても無視します。
function scheduleRemoteSave() {
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => {
    fetch("/api/plans/demo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: state })
    }).catch(() => {
      // ローカルAPIが止まっていても、画面操作自体は続けられるようにします。
    });
  }, 250);
}

// 初回表示、初期化、GitHub Pagesの静的デモで使う内蔵EPC工程サンプルです。
function seedState() {
  return {
    view: "network",
    area: "all",
    search: "",
    selected: "t4",
    selectedDependency: null,
    linkMode: false,
    linkSource: null,
    criticalOnly: false,
    networkDensity: "standard",
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

// サンプルタスクを短く書きつつ、必須項目を正規化するための生成関数です。
function task(id, code, name, area, owner, duration, x, y) {
  return normalizeTask({ id, code, name, area, owner, duration, progress: 0, x, y });
}

// 依存線の生成関数です。FS/SS/FF/SFとラグ日数を扱います。
function dep(id, from, to, type, lag, label = "") {
  return normalizeDependency({ id, from, to, type, lag, label });
}

// メイン描画処理です。工程計算、操作部品の同期、各ビュー再描画を順に行います。
function render() {
  schedule = calculateSchedule(state.tasks, state.dependencies);
  els.search.value = state.search || "";
  els.relationType.value = state.relationType || "FS";
  els.lagDays.value = state.lagDays || 0;
  els.edgeLabel.value = state.edgeLabel || "";
  ensureSelectedVisible();
  els.focusSelected.disabled = !getTask(state.selected);
  els.densityButtons.forEach((button) => {
    const active = button.dataset.density === state.networkDensity;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

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

// 工期、タスク数、依存線数、クリティカル数などの概要カードを描画します。
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

// 領域フィルターと、各領域に含まれるタスク数を描画します。
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
    <button class="chip critical-filter ${state.criticalOnly ? "active" : ""}" type="button" data-critical-only>
      <span>クリティカルのみ</span>
      <span class="badge">${[...schedule.items.values()].filter((item) => item.critical).length}</span>
    </button>
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

// クリティカル、余裕日数が少ない、または遅延している注目タスクを描画します。
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

// 依存ネットワークのタスクノードとSVG依存線を描画します。
function renderNetwork() {
  const visible = visibleTasks();
  const visibleIds = new Set(visible.map((taskItem) => taskItem.id));
  const size = nodeSize();
  networkBounds = calculateNetworkBounds(visible);
  els.network.style.width = `${networkBounds.width}px`;
  els.network.style.height = `${networkBounds.height}px`;
  els.network.style.setProperty("--node-width", `${size.width}px`);
  els.network.style.setProperty("--node-height", `${size.height}px`);
  els.network.classList.toggle("compact", state.networkDensity === "compact");
  renderAreaBands(visible, networkBounds);
  renderEdges(visibleIds, networkBounds);

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

// 複数の依存線が重なりすぎないよう、接続位置を少しずらして描画します。
function renderEdges(visibleIds, bounds = networkBounds) {
  const map = new Map(state.tasks.map((taskItem) => [taskItem.id, taskItem]));
  const size = nodeSize();
  els.edges.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);

  const defs = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#80868b"></path>
      </marker>
      <marker id="arrowCritical" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#b3261e"></path>
      </marker>
    </defs>
  `;

  const visibleDeps = state.dependencies.filter((item) => visibleIds.has(item.from) && visibleIds.has(item.to));
  const portMeta = buildEdgePortMeta(visibleDeps);

  const paths = visibleDeps
    .map((item, index) => {
      // 右方向の依存は右端から、戻り方向の依存は左端から線を出します。
      const from = map.get(item.from);
      const to = map.get(item.to);
      const fromData = schedule.items.get(item.from);
      const toData = schedule.items.get(item.to);
      const meta = portMeta.get(item.id);
      const forward = to.x >= from.x;
      const x1 = forward ? from.x + size.width : from.x;
      const x2 = forward ? to.x : to.x + size.width;
      const y1 = from.y + size.height / 2 + meta.fromOffset;
      const y2 = to.y + size.height / 2 + meta.toOffset;
      const direction = forward ? 1 : -1;
      const routeOffset = ((index % 7) - 3) * 18;
      const distanceX = Math.abs(x2 - x1);
      // 短い依存線では曲げを弱め、隣接ノード間の線が大きく暴れないようにします。
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
      const selected = state.selectedDependency === item.id;
      const path = `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;

      return `
        <g class="edge-group ${selected ? "selected" : ""}" data-dependency-id="${escapeAttr(item.id)}">
          <path class="edge-hit" d="${path}"></path>
          <path class="edge ${critical ? "critical" : ""} ${selected ? "selected" : ""}" d="${path}" marker-end="url(#${critical ? "arrowCritical" : "arrow"})"></path>
          <text class="edge-label ${selected ? "selected" : ""}" x="${labelX}" y="${labelY}">${escapeHtml(label)}</text>
        </g>
      `;
    })
    .join("");

  els.edges.innerHTML = defs + paths;
}

// ノード背面に領域別の帯を描き、広いネットワークでも所属を追いやすくします。
function renderAreaBands(tasks, bounds) {
  const size = nodeSize();
  const groups = new Map();
  tasks.forEach((taskItem) => {
    if (!groups.has(taskItem.area)) groups.set(taskItem.area, []);
    groups.get(taskItem.area).push(taskItem);
  });

  els.areaBands.innerHTML = [...groups.entries()]
    .map(([area, areaTasks]) => {
      const minY = Math.min(...areaTasks.map((taskItem) => taskItem.y));
      const maxY = Math.max(...areaTasks.map((taskItem) => taskItem.y + size.height));
      const top = Math.max(0, minY - 28);
      const height = Math.max(size.height + 56, maxY - minY + 56);
      return `
        <div class="area-band" style="top:${top}px;height:${height}px;width:${bounds.width}px;--area-color:${areaColor(area)}">
          <span>${escapeHtml(area)}</span>
        </div>
      `;
    })
    .join("");
}

// 選択中タスクが見つけやすいように、ネットワーク表示をその位置へスクロールします。
function focusSelectedTask(options = {}) {
  const selected = getTask(state.selected);
  const node = findNodeElement(state.selected);
  if (!selected || !node) {
    if (!options.silent) setStatus("表示中のタスクを選択してください", "warn");
    return;
  }

  const size = nodeSize();
  const networkLeft = els.network.offsetLeft;
  const networkTop = els.network.offsetTop;
  const left = clamp(networkLeft + selected.x - els.networkView.clientWidth / 2 + size.width / 2, 0, Math.max(0, els.networkView.scrollWidth - els.networkView.clientWidth), 0);
  const top = clamp(networkTop + selected.y - els.networkView.clientHeight / 2 + size.height / 2, 0, Math.max(0, els.networkView.scrollHeight - els.networkView.clientHeight), 0);
  els.networkView.scrollTo({ left, top, behavior: "smooth" });
  node.classList.remove("focus-pulse");
  void node.offsetWidth;
  node.classList.add("focus-pulse");
  node.addEventListener("animationend", () => node.classList.remove("focus-pulse"), { once: true });

  if (!options.silent) {
    setStatus(`選択タスクへ移動: ${selected.code} ${selected.name}`);
  }
}

// 入出力が多いノードでも線を見分けやすいよう、依存線の端点を上下に分散します。
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
    // 出力側の接続位置は、接続先タスクの縦位置順に並べます。
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
    // 入力側の接続位置は、接続元タスクの縦位置順に並べます。
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

// 最早開始日と期間から、簡易ガントチャートを描画します。
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

// 編集可能な表を描画します。変更内容は他ビューと同じタスク状態へ反映します。
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

// 選択中タスクの詳細編集パネルを描画します。
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
      <div class="inspector-actions">
        <button type="button" class="delete-task-button" data-delete-task="${escapeAttr(selected.id)}">タスク削除</button>
      </div>
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

// ネットワークノードのクリック処理です。通常は選択、接続モードでは依存線を作成/更新します。
function onNodeClick(id) {
  if (!state.linkMode) {
    state.selected = id;
    state.selectedDependency = null;
    saveState();
    render();
    return;
  }

  if (!state.linkSource || state.linkSource === id) {
    state.linkSource = state.linkSource === id ? null : id;
    state.selected = id;
    state.selectedDependency = null;
    saveState();
    render();
    return;
  }

  const existing = state.dependencies.find((item) => item.from === state.linkSource && item.to === id);
  const nextDeps = [
    ...state.dependencies,
    dep(`d${Date.now()}`, state.linkSource, id, state.relationType, clamp(parseInt(state.lagDays, 10), -30, 90, 0), state.edgeLabel)
  ];

  if (!existing && hasCycle(state.tasks, nextDeps)) {
    // 循環依存はすぐに拒否し、工程計算に必要なDAG構造を守ります。
    setStatus("循環依存になるため接続できません", "error");
    return;
  }

  if (existing) {
    existing.type = state.relationType;
    existing.lag = state.lagDays;
    existing.label = state.edgeLabel;
    state.selectedDependency = existing.id;
  } else {
    state.dependencies = nextDeps;
    state.selectedDependency = nextDeps[nextDeps.length - 1].id;
  }

  state.selected = id;
  saveState();
  render();
  requestAnimationFrame(() => focusDependencyRow(state.selectedDependency));
}

// 依存線をクリックしたら、その依存を選択して右ペインの編集行を表示します。
function onEdgeClick(event) {
  const group = event.target.closest("[data-dependency-id]");
  if (!group) return;
  const item = state.dependencies.find((depItem) => depItem.id === group.dataset.dependencyId);
  if (!item) return;

  state.linkMode = false;
  state.linkSource = null;
  state.selectedDependency = item.id;
  state.selected = [item.from, item.to].includes(state.selected) ? state.selected : item.to;
  saveState();
  render();
  requestAnimationFrame(() => focusDependencyRow(item.id));

  const from = getTask(item.from);
  const to = getTask(item.to);
  setStatus(`依存線を選択: ${from?.code || item.from} → ${to?.code || item.to}`);
}

// ネットワーク上でタスクノードのドラッグを開始します。
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

// ドラッグ中はノード位置を更新し、反応を軽くするため依存線だけを再描画します。
function moveDrag(event) {
  if (!drag) return;
  const taskItem = getTask(drag.id);
  const dx = event.clientX - drag.sx;
  const dy = event.clientY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  const size = nodeSize();
  taskItem.x = clamp(drag.ox + dx, 8, Math.max(8, networkBounds.width - size.width - 24), drag.ox);
  taskItem.y = clamp(drag.oy + dy, 8, Math.max(8, networkBounds.height - size.height - 24), drag.oy);
  drag.node.style.left = `${taskItem.x}px`;
  drag.node.style.top = `${taskItem.y}px`;
  renderEdges(new Set(visibleTasks().map((task) => task.id)), networkBounds);
}

// ドラッグ終了時に位置を保存し、直後に発生する不要なclickを抑止します。
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

// 表ビューで編集された値をタスク状態へ反映します。
function onTableChange(event) {
  const row = event.target.closest("[data-id]");
  if (!row || !event.target.dataset.field) return;
  updateTask(row.dataset.id, event.target.dataset.field, event.target.value);
}

// 右ペインで編集されたタスクまたは依存線の値を反映します。
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

// メモ入力中は再描画でカーソルを奪わないよう、値だけ保存します。
function onInspectorInput(event) {
  if (event.target.dataset.inspector !== "description") return;
  const taskItem = getTask(state.selected);
  if (!taskItem) return;
  taskItem.description = event.target.value.trim().slice(0, 300);
  saveState();
}

// 詳細パネル上の依存線削除やタスク削除ボタンを処理します。
function onInspectorClick(event) {
  const deleteTaskButton = event.target.closest("[data-delete-task]");
  if (deleteTaskButton) {
    deleteTask(deleteTaskButton.dataset.deleteTask);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-dependency]");
  if (!deleteButton) return;
  state.dependencies = state.dependencies.filter((item) => item.id !== deleteButton.dataset.deleteDependency);
  if (state.selectedDependency === deleteButton.dataset.deleteDependency) state.selectedDependency = null;
  saveState();
  render();
}

// タスクの1項目を更新し、関係するビューを再描画します。
function updateTask(id, field, value) {
  const taskItem = getTask(id);
  if (!taskItem) return;
  if (field === "duration") taskItem.duration = clamp(parseInt(value, 10), 1, 365, taskItem.duration);
  else if (field === "progress") taskItem.progress = clamp(parseInt(value, 10), 0, 100, taskItem.progress);
  else if (field === "status") taskItem.status = statusValues().includes(value) ? value : taskItem.status;
  else if (field === "level") taskItem.level = levelValues().includes(value) ? value : taskItem.level;
  else if (["plannedStart", "plannedEnd", "actualStart", "actualEnd"].includes(field)) taskItem[field] = normalizeDate(value);
  else if (field === "description") taskItem.description = String(value).trim().slice(0, 300);
  else if (field === "owner") taskItem.owner = String(value).trim().slice(0, 60);
  else if (["code", "name", "area"].includes(field)) taskItem[field] = String(value).trim() || taskItem[field];
  if (field === "area" && !state.areas.includes(taskItem.area)) state.areas.push(taskItem.area);
  state.selected = id;
  state.selectedDependency = null;
  saveState();
  render();
}

// 依存線の接続元/接続先は変えず、種別、ラグ、ラベルだけを更新します。
function updateDependency(id, field, value) {
  const item = state.dependencies.find((depItem) => depItem.id === id);
  if (!item) return;
  if (field === "type") item.type = RELATIONS.includes(value) ? value : item.type;
  else if (field === "lag") item.lag = clamp(parseInt(value, 10), -30, 90, item.lag);
  else if (field === "label") item.label = String(value).trim().slice(0, 30);
  state.selectedDependency = id;
  saveState();
  render();
}

// 確認後にタスクを削除し、そのタスクに接続する依存線もまとめて削除します。
function deleteTask(id) {
  const taskItem = getTask(id);
  if (!taskItem) return;
  const connectedCount = state.dependencies.filter((item) => item.from === id || item.to === id).length;
  const message = connectedCount
    ? `${taskItem.code} ${taskItem.name} を削除します。関連する依存線 ${connectedCount} 本も削除されます。`
    : `${taskItem.code} ${taskItem.name} を削除します。`;
  if (!window.confirm(message)) return;

  state.tasks = state.tasks.filter((item) => item.id !== id);
  state.dependencies = state.dependencies.filter((item) => item.from !== id && item.to !== id);
  if (state.linkSource === id) state.linkSource = null;
  if (!state.dependencies.some((item) => item.id === state.selectedDependency)) state.selectedDependency = null;
  state.selected = state.tasks[0]?.id || null;
  saveState();
  render();
  setStatus("タスクを削除しました");
}

// 現在の領域フィルターに合わせて新規タスクを作り、すぐ編集できるよう選択します。
function addTask() {
  const id = `t${Date.now()}`;
  const taskItem = task(id, `N${state.tasks.length + 1}`, "新規タスク", state.area === "all" ? getAreas()[0] : state.area, "", 5, 80, 120);
  state.tasks.push(taskItem);
  state.selected = id;
  state.selectedDependency = null;
  saveState();
  render();
}

// 依存の世代ごとに横配置し、同じ列のタスクは縦に積んで重なりを避けます。
function autoLayout() {
  const areas = getAreas();
  const generations = computeDependencyGenerations();
  const rowHeight = layoutRowHeight();
  let areaTop = LAYOUT_MARGIN_Y;

  areas.forEach((area) => {
    const areaTasks = state.tasks.filter((taskItem) => taskItem.area === area);
    if (!areaTasks.length) return;

    const byColumn = new Map();
    areaTasks
      .slice()
      .sort((a, b) => {
        const aGen = generations.get(a.id) || 0;
        const bGen = generations.get(b.id) || 0;
        return aGen - bGen || schedule.items.get(a.id).es - schedule.items.get(b.id).es || a.code.localeCompare(b.code);
      })
      .forEach((taskItem) => {
        const column = generations.get(taskItem.id) || 0;
        if (!byColumn.has(column)) byColumn.set(column, []);
        byColumn.get(column).push(taskItem);
      });

    let maxRows = 1;
    byColumn.forEach((tasksInColumn, column) => {
      maxRows = Math.max(maxRows, tasksInColumn.length);
      tasksInColumn.forEach((taskItem, row) => {
        taskItem.x = LAYOUT_MARGIN_X + column * LAYOUT_COL_W;
        taskItem.y = areaTop + row * rowHeight;
      });
    });

    areaTop += maxRows * rowHeight + LAYOUT_AREA_GAP;
  });
}

// 後続タスクが右へ進むよう、依存関係から安定した世代番号を計算します。
function computeDependencyGenerations() {
  const ids = new Set(state.tasks.map((taskItem) => taskItem.id));
  const outgoing = new Map(state.tasks.map((taskItem) => [taskItem.id, []]));
  const indegree = new Map(state.tasks.map((taskItem) => [taskItem.id, 0]));
  const generations = new Map(state.tasks.map((taskItem) => [taskItem.id, 0]));

  state.dependencies.forEach((item) => {
    if (!ids.has(item.from) || !ids.has(item.to)) return;
    outgoing.get(item.from).push(item.to);
    indegree.set(item.to, indegree.get(item.to) + 1);
  });

  const queue = state.tasks
    .filter((taskItem) => indegree.get(taskItem.id) === 0)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((taskItem) => taskItem.id);

  while (queue.length) {
    const id = queue.shift();
    outgoing.get(id).forEach((to) => {
      generations.set(to, Math.max(generations.get(to) || 0, (generations.get(id) || 0) + 1));
      indegree.set(to, indegree.get(to) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    });
  }

  return generations;
}

// 表示中ノードを収めるようにネットワークキャンバスの大きさを調整します。
function calculateNetworkBounds(tasks) {
  const size = nodeSize();
  if (!tasks.length) return { width: NETWORK_MIN_W, height: NETWORK_MIN_H };
  const maxX = Math.max(...tasks.map((taskItem) => taskItem.x + size.width));
  const maxY = Math.max(...tasks.map((taskItem) => taskItem.y + size.height));
  return {
    width: Math.max(NETWORK_MIN_W, Math.ceil(maxX + LAYOUT_MARGIN_X)),
    height: Math.max(NETWORK_MIN_H, Math.ceil(maxY + LAYOUT_MARGIN_Y))
  };
}

// CPM風に最早/最遅日、総工期、余裕日数、クリティカル判定を計算します。
function calculateSchedule(tasks, dependencies) {
  const map = new Map(tasks.map((taskItem) => [taskItem.id, taskItem]));
  const items = new Map(tasks.map((taskItem) => [taskItem.id, { es: 0, ef: taskItem.duration, ls: 0, lf: 0, float: 0, critical: false }]));
  const outgoing = new Map(tasks.map((taskItem) => [taskItem.id, []]));
  const indegree = new Map(tasks.map((taskItem) => [taskItem.id, 0]));

  for (const item of dependencies) {
    // トポロジカル順にたどるため、隣接リストと入次数を作ります。
    if (!map.has(item.from) || !map.has(item.to)) continue;
    outgoing.get(item.from).push(item);
    indegree.set(item.to, indegree.get(item.to) + 1);
  }

  const queue = tasks.filter((taskItem) => indegree.get(taskItem.id) === 0).map((taskItem) => taskItem.id);
  const topo = [];
  while (queue.length) {
    // Kahn法のトポロジカルソートで、前進/後退計算に使える安全な順序を作ります。
    const id = queue.shift();
    topo.push(id);
    for (const item of outgoing.get(id)) {
      indegree.set(item.to, indegree.get(item.to) - 1);
      if (indegree.get(item.to) === 0) queue.push(item.to);
    }
  }

  for (const id of topo) {
    // 前進計算では、先行依存のオフセットから最早開始日を押し出します。
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
    // すべての最早開始日が決まった後、最早終了日を正規化します。
    const item = items.get(taskItem.id);
    item.ef = item.es + taskItem.duration;
  }

  const duration = Math.max(0, ...[...items.values()].map((item) => item.ef));

  for (const taskItem of tasks) {
    // 後退計算はプロジェクト終了日を基準に初期化します。
    const item = items.get(taskItem.id);
    item.ls = duration - taskItem.duration;
    item.lf = duration;
  }

  for (const id of topo.slice().reverse()) {
    // 後退計算では、後続タスクの最遅開始日から最遅開始日を引き戻します。
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

// FS/SS/FF/SFの意味を、開始日同士のオフセットへ変換します。
function dependencyOffset(item, from, to) {
  const lag = Number(item.lag) || 0;
  if (item.type === "SS") return lag;
  if (item.type === "FF") return from.duration + lag - to.duration;
  if (item.type === "SF") return lag - to.duration;
  return from.duration + lag;
}

// 新しい依存線を受け入れる前に、循環依存ができないか検出します。
function hasCycle(tasks, dependencies) {
  const ids = new Set(tasks.map((taskItem) => taskItem.id));
  const outgoing = new Map(tasks.map((taskItem) => [taskItem.id, []]));
  const indegree = new Map(tasks.map((taskItem) => [taskItem.id, 0]));
  dependencies.forEach((item) => {
    // 存在しないタスクを指す依存線は、防御的に無視します。
    if (!ids.has(item.from) || !ids.has(item.to)) return;
    outgoing.get(item.from).push(item.to);
    indegree.set(item.to, indegree.get(item.to) + 1);
  });
  const queue = tasks.filter((taskItem) => indegree.get(taskItem.id) === 0).map((taskItem) => taskItem.id);
  let visited = 0;
  while (queue.length) {
    // すべてのタスクを訪問できなければ、循環依存が残っています。
    const id = queue.shift();
    visited += 1;
    outgoing.get(id).forEach((to) => {
      indegree.set(to, indegree.get(to) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    });
  }
  return visited !== tasks.length;
}

// 現在の領域、クリティカル、検索文字列フィルターを適用します。
function visibleTasks() {
  const q = (state.search || "").toLowerCase();
  return state.tasks.filter((taskItem) => {
    const areaOk = state.area === "all" || taskItem.area === state.area;
    const criticalOk = !state.criticalOnly || schedule.items.get(taskItem.id)?.critical;
    const text = `${taskItem.code} ${taskItem.name} ${taskItem.owner} ${taskItem.area} ${taskItem.description} ${taskItem.status} ${taskItem.level}`.toLowerCase();
    return areaOk && criticalOk && (!q || text.includes(q));
  });
}

// フィルター変更後も、詳細パネルが表示中タスクを指すように補正します。
function ensureSelectedVisible() {
  const visible = visibleTasks();
  if (!visible.length) {
    state.selected = null;
    return;
  }
  if (!visible.some((taskItem) => taskItem.id === state.selected)) {
    state.selected = visible[0].id;
  }
}

// 表ビューに表示する先行タスクの短い説明を返します。
function predecessorSummaries(id) {
  return state.dependencies
    .filter((item) => item.to === id)
    .map((item) => {
      const source = getTask(item.from);
      return source ? `${source.code} ${dependencyLabel(item)}` : "";
    })
    .filter(Boolean);
}

// タスクIDからタスクを探します。
function getTask(id) {
  return state.tasks.find((taskItem) => taskItem.id === id);
}

// 古いlocalStorageやJSONでも、新しい項目を補完して動くように正規化します。
function normalizeState(raw) {
  if (!raw || !Array.isArray(raw.tasks) || !Array.isArray(raw.dependencies)) return seedState();
  const tasks = raw.tasks.map(normalizeTask);
  const dependencies = raw.dependencies.map(normalizeDependency);
  const taskAreas = tasks.map((taskItem) => taskItem.area).filter(Boolean);
  const areas = unique([...(Array.isArray(raw.areas) ? raw.areas : []), ...DEFAULT_AREAS, ...taskAreas]);
  const area = raw.area === "all" || areas.includes(raw.area) ? raw.area : "all";

  return {
    ...raw,
    view: ["network", "gantt", "table"].includes(raw.view) ? raw.view : "network",
    area,
    search: raw.search || "",
    selected: tasks.some((taskItem) => taskItem.id === raw.selected) ? raw.selected : tasks[0]?.id,
    selectedDependency: dependencies.some((item) => item.id === raw.selectedDependency) ? raw.selectedDependency : null,
    linkMode: Boolean(raw.linkMode),
    linkSource: raw.linkSource || null,
    criticalOnly: Boolean(raw.criticalOnly),
    networkDensity: raw.networkDensity === "compact" ? "compact" : "standard",
    relationType: RELATIONS.includes(raw.relationType) ? raw.relationType : "FS",
    lagDays: clamp(parseInt(raw.lagDays, 10), -30, 90, 0),
    edgeLabel: String(raw.edgeLabel || "").slice(0, 30),
    areas,
    tasks,
    dependencies
  };
}

// 初期MVP後に追加したタスク項目を補完します。
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
    x: normalizePosition(raw.x, 80),
    y: normalizePosition(raw.y, 120)
  };
}

// 初期MVP後に追加した依存線項目を補完します。
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

// 選択中タスクにつながる先行依存と後続依存の編集行を描画します。
function renderDependencyEditor(taskId) {
  const incoming = state.dependencies.filter((item) => item.to === taskId);
  const outgoing = state.dependencies.filter((item) => item.from === taskId);

  return `
    <div class="dependency-editor">
      ${renderDependencyGroup("先行依存", incoming, "from")}
      ${renderDependencyGroup("後続依存", outgoing, "to")}
      ${incoming.length || outgoing.length ? "" : `<p class="note">依存線はありません。依存接続でタスク同士をつなげます。</p>`}
    </div>
  `;
}

// 先行依存または後続依存の1セクションを描画します。
function renderDependencyGroup(title, items, peerField) {
  return `
    <div class="dependency-group">
      <h3>${title}</h3>
      ${items.length ? items.map((item) => renderDependencyRow(item, peerField)).join("") : `<p class="note">なし</p>`}
    </div>
  `;
}

// 編集可能な依存線1行を描画します。
function renderDependencyRow(item, peerField) {
  const peer = getTask(item[peerField]);
  const arrow = peerField === "from" ? "←" : "→";
  return `
    <div class="dependency-row ${state.selectedDependency === item.id ? "selected-dependency" : ""}" data-dependency-id="${escapeAttr(item.id)}">
      <strong>${arrow} ${escapeHtml(peer ? `${peer.code} ${peer.name}` : item[peerField])}</strong>
      <select data-dependency-field="type">${RELATIONS.map((type) => `<option value="${type}" ${type === item.type ? "selected" : ""}>${type}</option>`).join("")}</select>
      <input data-dependency-field="lag" type="number" min="-30" max="90" value="${item.lag}">
      <input data-dependency-field="label" maxlength="30" placeholder="線ラベル" value="${escapeAttr(item.label || "")}">
      <button type="button" data-delete-dependency="${escapeAttr(item.id)}">削除</button>
    </div>
  `;
}

function nodeSize() {
  return NODE_SIZES[state.networkDensity === "compact" ? "compact" : "standard"];
}

function layoutRowHeight() {
  const size = nodeSize();
  return size.height + size.rowGap;
}

function findNodeElement(id) {
  return [...els.nodes.querySelectorAll(".node")].find((node) => node.dataset.id === id);
}

function focusDependencyRow(id) {
  const row = [...els.inspector.querySelectorAll("[data-dependency-id]")].find((item) => item.dataset.dependencyId === id);
  if (!row) return;
  row.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// フィルターやタスク編集で使う任意の所属/領域を追加します。
function addArea() {
  const input = els.filters.querySelector("[data-new-area]");
  const value = input?.value.trim().slice(0, 24);
  if (!value) return;
  if (!state.areas.includes(value)) state.areas.push(value);
  state.area = value;
  saveState();
  render();
}

// 未使用の任意所属/領域を削除します。
function deleteArea(area) {
  if (DEFAULT_AREAS.includes(area) || state.tasks.some((taskItem) => taskItem.area === area)) return;
  state.areas = state.areas.filter((item) => item !== area);
  if (state.area === area) state.area = "all";
  saveState();
  render();
}

// 既知の所属/領域を、安定した表示順で返します。
function getAreas() {
  return unique([...(state.areas || []), ...DEFAULT_AREAS, ...state.tasks.map((taskItem) => taskItem.area)]);
}

// 所属/領域ごとに一貫した表示色を選びます。
function areaColor(area) {
  const areas = getAreas();
  const index = Math.max(0, areas.indexOf(area));
  return AREA_COLORS[index % AREA_COLORS.length];
}

// SVG依存線と表の先行欄に出す短い依存ラベルを作ります。
function dependencyLabel(item) {
  const lag = item.lag ? item.lag > 0 ? `+${item.lag}` : item.lag : "";
  return `${item.type}${lag}${item.label ? ` · ${item.label}` : ""}`;
}

// 手動ステータスに加え、予定/実績日から簡易的な遅延表示を計算します。
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

// ステータスバーの文言と警告/エラー表示クラスを更新します。
function setStatus(text, type = "") {
  els.status.textContent = text;
  els.status.className = `status ${type}`.trim();
}

// 数値入力を指定範囲に丸め、不正値ならフォールバック値を使います。
function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

// 自動整列や大きな工程で広がった配置を、再読み込み時に固定上限で潰さないようにします。
function normalizePosition(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(8, parsed) : fallback;
}

// HTMLテンプレートへ差し込む前に文字列をエスケープします。
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 属性値のエスケープも、現時点ではHTML本文と同じ処理を使います。
function escapeAttr(value) {
  return escapeHtml(value);
}
