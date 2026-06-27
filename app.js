const STORAGE_KEY = "softball-scorebook-records-v1";
const SCRIPT_URL_KEY = "softball-scorebook-script-url";
const AUTO_PULL_INTERVAL_MS = 60000;

const fields = ["ab", "single", "double", "triple", "hr", "bb", "sf", "rbi", "run", "error"];
const headers = ["id", "date", "opponent", "inning", "player", "outcome", ...fields, "note"];
const outcomeStats = {
  out: { label: "出局", ab: 1 },
  single: { label: "一安", ab: 1, single: 1 },
  double: { label: "二安", ab: 1, double: 1 },
  triple: { label: "三安", ab: 1, triple: 1 },
  hr: { label: "全壘打", ab: 1, hr: 1 },
  bb: { label: "保送", bb: 1 },
  sf: { label: "犧飛", sf: 1 },
  error: { label: "失誤上壘", ab: 1, error: 1 },
};

const state = {
  records: loadRecords(),
  deferredInstallPrompt: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const form = $("#recordForm");
const playerList = $("#playerList");
const gameFilter = $("#gameFilter");
const playerFilter = $("#playerFilter");
const recordsList = $("#recordsList");
const syncStatus = $("#syncStatus");
const scriptUrlInput = $("#scriptUrl");
const avgTrendChart = $("#avgTrendChart");
const avgTrendEmpty = $("#avgTrendEmpty");
const avgTrendCurrent = $("#avgTrendCurrent");
const teamSplits = $("#teamSplits");

init();

function init() {
  form.elements.date.valueAsDate = new Date();
  scriptUrlInput.value = localStorage.getItem(SCRIPT_URL_KEY) || "";

  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  form.addEventListener("submit", saveRecord);
  $("#clearFormButton").addEventListener("click", resetForm);
  $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#importCsvInput").addEventListener("change", importCsv);
  $("#pushButton").addEventListener("click", pushToDrive);
  $("#pullButton").addEventListener("click", pullFromDrive);
  scriptUrlInput.addEventListener("change", () => {
    localStorage.setItem(SCRIPT_URL_KEY, scriptUrlInput.value.trim());
    pullFromDrive({ silent: true });
  });
  gameFilter.addEventListener("change", () => {
    renderPlayers();
    renderStats();
  });
  playerFilter.addEventListener("change", renderStats);
  window.addEventListener("resize", () => {
    if ($("#statsView").classList.contains("active")) renderStats();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    $("#installButton").hidden = false;
  });

  $("#installButton").addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    $("#installButton").hidden = true;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js");
  }

  render();
  pullFromDrive({ silent: true });
  window.setInterval(() => pullFromDrive({ silent: true }), AUTO_PULL_INTERVAL_MS);
}

function switchTab(tabName) {
  $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${tabName}View`));
  if (tabName === "stats") renderStats();
}

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
}

function saveRecord(event) {
  event.preventDefault();
  const data = new FormData(form);
  const outcome = clean(data.get("outcome"));
  const derived = outcomeStats[outcome];
  if (!derived) return;

  const record = {
    id: crypto.randomUUID(),
    date: data.get("date"),
    opponent: clean(data.get("opponent")),
    inning: clean(data.get("inning")),
    player: clean(data.get("player")),
    outcome,
    note: clean(data.get("note")),
  };

  fields.forEach((field) => {
    record[field] = number(derived[field]);
  });
  record.rbi = number(data.get("rbi"));
  record.run = number(data.get("run"));

  state.records.unshift(record);
  persist();
  resetForm();
  render();
  switchTab("stats");
  autoSyncRecord(record);
}

function resetForm() {
  const date = form.elements.date.value;
  const opponent = form.elements.opponent.value;
  const inning = form.elements.inning.value;
  form.reset();
  form.elements.date.value = date || new Date().toISOString().slice(0, 10);
  form.elements.opponent.value = opponent;
  form.elements.inning.value = inning;
  form.elements.rbi.value = 0;
  form.elements.run.value = 0;
}

function render() {
  renderSummary();
  renderGameFilter();
  renderPlayers();
  renderStats();
  renderRecords();
}

function renderSummary() {
  const totals = calculateTotals(state.records);
  $("#playerCount").textContent = getPlayers().length;
  $("#teamPa").textContent = totals.pa;
  $("#teamOps").textContent = rate(totals.ops);
}

function renderPlayers() {
  const players = getPlayers(getGameFilteredRecords());
  playerList.innerHTML = players.map((player) => `<option value="${escapeHtml(player)}"></option>`).join("");

  const current = playerFilter.value;
  playerFilter.innerHTML = [
    `<option value="__team__">全隊</option>`,
    ...players.map((player) => `<option value="${escapeHtml(player)}">${escapeHtml(player)}</option>`),
  ].join("");
  playerFilter.value = players.includes(current) ? current : "__team__";
}

function renderStats() {
  const baseRecords = getGameFilteredRecords();
  const players = getPlayers(baseRecords);
  const rows = players
    .map((player) => ({ player, totals: calculateTotals(baseRecords.filter((record) => record.player === player)) }))
    .sort((a, b) => b.totals.ops - a.totals.ops || b.totals.hits - a.totals.hits);

  $("#leaderboardBody").innerHTML = rows.length
    ? rows.map(renderLeaderboardRow).join("")
    : `<tr><td colspan="8">還沒有成績，先輸入第一筆打席紀錄。</td></tr>`;

  const selected = playerFilter.value;
  const filteredRecords = selected === "__team__" ? baseRecords : baseRecords.filter((record) => record.player === selected);
  const totals = calculateTotals(filteredRecords);
  const title = `${selected === "__team__" ? "全隊成績" : selected || "全隊成績"}${gameFilter.value !== "__all__" ? `｜${selectedGameLabel()}` : ""}`;
  $("#selectedPlayerStats").innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    <div class="metrics">
      ${metric("AVG", rate(totals.avg))}
      ${metric("OBP", rate(totals.obp))}
      ${metric("SLG", rate(totals.slg))}
      ${metric("OPS", rate(totals.ops))}
      ${metric("AB", totals.ab)}
      ${metric("H", totals.hits)}
      ${metric("RBI", totals.rbi)}
      ${metric("PA", totals.pa)}
    </div>
  `;
  renderTeamSplits(selected);
  renderAvgTrend(filteredRecords);
}

function renderLeaderboardRow({ player, totals }) {
  return `
    <tr>
      <td>${escapeHtml(player)}</td>
      <td>${totals.ab}</td>
      <td>${totals.hits}</td>
      <td>${totals.rbi}</td>
      <td>${rate(totals.avg)}</td>
      <td>${rate(totals.obp)}</td>
      <td>${rate(totals.slg)}</td>
      <td>${rate(totals.ops)}</td>
    </tr>
  `;
}

function renderRecords() {
  recordsList.innerHTML = "";
  if (!state.records.length) {
    recordsList.innerHTML = `<div class="sync-status">目前沒有紀錄。</div>`;
    return;
  }

  const template = $("#recordTemplate");
  state.records.forEach((record) => {
    const totals = calculateTotals([record]);
    const node = template.content.cloneNode(true);
    const outcomeLabel = outcomeStats[record.outcome]?.label || summarizeLegacyOutcome(record);
    node.querySelector(".record-title").textContent = `${record.player}：${outcomeLabel}`;
    node.querySelector(".record-meta").textContent = `${record.date}${record.inning ? `｜${record.inning}局` : ""}｜vs ${record.opponent || "未填對手"}`;
    node.querySelector(".record-line").textContent =
      `AB ${record.ab}｜H ${totals.hits}｜RBI ${record.rbi}｜R ${record.run}｜BB ${record.bb}`;
    node.querySelector(".delete-record").addEventListener("click", () => deleteRecord(record.id));
    recordsList.appendChild(node);
  });
}

function deleteRecord(id) {
  state.records = state.records.filter((record) => record.id !== id);
  persist();
  render();
  autoDeleteRecord(id);
}

function renderGameFilter() {
  const current = gameFilter.value;
  const games = getGames(state.records);
  gameFilter.innerHTML = [
    `<option value="__all__">全部場次</option>`,
    ...games.map((game) => `<option value="${escapeHtml(game.key)}">${escapeHtml(gameLabel(game))}</option>`),
  ].join("");
  gameFilter.value = games.some((game) => game.key === current) ? current : "__all__";
}

function getGameFilteredRecords() {
  const key = gameFilter.value;
  if (!key || key === "__all__") return state.records;
  return state.records.filter((record) => gameKey(record) === key);
}

function selectedGameLabel() {
  const game = getGames(state.records).find((item) => item.key === gameFilter.value);
  return game ? gameLabel(game) : "全部場次";
}

function getPlayers(records = state.records) {
  return [...new Set(records.map((record) => record.player).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function calculateTotals(records) {
  const totals = {
    pa: 0,
    ab: 0,
    hits: 0,
    singles: 0,
    doubles: 0,
    triples: 0,
    hr: 0,
    bb: 0,
    sf: 0,
    rbi: 0,
    run: 0,
    error: 0,
    totalBases: 0,
  };

  records.forEach((record) => {
    totals.ab += number(record.ab);
    totals.singles += number(record.single);
    totals.doubles += number(record.double);
    totals.triples += number(record.triple);
    totals.hr += number(record.hr);
    totals.bb += number(record.bb);
    totals.sf += number(record.sf);
    totals.rbi += number(record.rbi);
    totals.run += number(record.run);
    totals.error += number(record.error);
  });

  totals.hits = totals.singles + totals.doubles + totals.triples + totals.hr;
  totals.totalBases = totals.singles + totals.doubles * 2 + totals.triples * 3 + totals.hr * 4;
  totals.pa = totals.ab + totals.bb + totals.sf;
  totals.avg = divide(totals.hits, totals.ab);
  totals.obp = divide(totals.hits + totals.bb, totals.ab + totals.bb + totals.sf);
  totals.slg = divide(totals.totalBases, totals.ab);
  totals.ops = totals.obp + totals.slg;
  return totals;
}

function renderTeamSplits(selected) {
  if (selected !== "__team__" || gameFilter.value !== "__all__") {
    teamSplits.hidden = true;
    teamSplits.innerHTML = "";
    return;
  }

  const games = getGames(state.records);
  const lastGame = games[games.length - 1];
  const recentFive = games.slice(-5);
  teamSplits.hidden = false;

  if (!lastGame) {
    teamSplits.innerHTML = `
      <article class="team-split-card">
        <h3>上一場</h3>
        <p>尚無比賽資料</p>
      </article>
      <article class="team-split-card">
        <h3>最近五場</h3>
        <p>尚無比賽資料</p>
      </article>
    `;
    return;
  }

  const lastTotals = calculateTotals(lastGame.records);
  const recentTotals = calculateTotals(recentFive.flatMap((game) => game.records));
  const recentLabel = recentFive.length === 1
    ? gameLabel(recentFive[0])
    : `${formatChartDate(recentFive[0].date)} - ${formatChartDate(recentFive[recentFive.length - 1].date)}｜${recentFive.length} 場`;

  teamSplits.innerHTML = `
    ${teamSplitCard("上一場", gameLabel(lastGame), lastTotals)}
    ${teamSplitCard("最近五場", recentLabel, recentTotals)}
  `;
}

function teamSplitCard(title, subtitle, totals) {
  return `
    <article class="team-split-card">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(subtitle)}</p>
      <div class="mini-metrics">
        ${miniMetric("AVG", rate(totals.avg))}
        ${miniMetric("OBP", rate(totals.obp))}
        ${miniMetric("SLG", rate(totals.slg))}
        ${miniMetric("OPS", rate(totals.ops))}
        ${miniMetric("PA", totals.pa)}
        ${miniMetric("H", totals.hits)}
        ${miniMetric("RBI", totals.rbi)}
        ${miniMetric("R", totals.run)}
      </div>
    </article>
  `;
}

function miniMetric(label, value) {
  return `<div class="mini-metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderAvgTrend(records) {
  const games = getRecentGames(records);
  avgTrendEmpty.hidden = games.length > 0;
  avgTrendChart.hidden = games.length === 0;
  avgTrendCurrent.textContent = games.length ? rate(games[games.length - 1].avg) : ".000";
  if (!games.length) return;

  const context = avgTrendChart.getContext("2d");
  const rect = avgTrendChart.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  avgTrendChart.width = Math.max(1, Math.floor(rect.width * scale));
  avgTrendChart.height = Math.max(1, Math.floor(rect.height * scale));
  context.setTransform(scale, 0, 0, scale, 0, 0);
  drawAvgTrend(context, games, rect.width, rect.height);
}

function drawAvgTrend(context, games, width, height) {
  const padding = { top: 18, right: 18, bottom: 48, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxAvg = Math.max(1, ...games.map((game) => game.avg));
  const yMax = Math.max(1, Math.ceil(maxAvg * 10) / 10);

  context.clearRect(0, 0, width, height);
  context.lineWidth = 1;
  context.font = "12px ui-sans-serif, system-ui, sans-serif";
  context.textBaseline = "middle";

  [0, 0.25, 0.5, 0.75, 1].forEach((tick) => {
    const y = padding.top + plotHeight - (tick / yMax) * plotHeight;
    context.strokeStyle = "rgba(100, 113, 107, 0.18)";
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = "#64716b";
    context.textAlign = "right";
    context.fillText(rate(tick), padding.left - 8, y);
  });

  const points = games.map((game, index) => {
    const x = games.length === 1
      ? padding.left + plotWidth / 2
      : padding.left + (index / (games.length - 1)) * plotWidth;
    const y = padding.top + plotHeight - (game.avg / yMax) * plotHeight;
    return { ...game, x, y };
  });

  const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, "rgba(216, 139, 42, 0.28)");
  gradient.addColorStop(1, "rgba(216, 139, 42, 0)");

  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.lineTo(points[points.length - 1].x, padding.top + plotHeight);
  context.lineTo(points[0].x, padding.top + plotHeight);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.strokeStyle = "#176b55";
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();

  points.forEach((point) => {
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#176b55";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(point.x, point.y, 5, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = "#17211c";
    context.textAlign = "center";
    context.fillText(rate(point.avg), point.x, Math.max(12, point.y - 18));
    context.fillStyle = "#64716b";
    context.fillText(formatChartDate(point.date), point.x, height - 24);
  });
}

function getRecentGames(records) {
  return getGames(records).slice(-5).map((game) => {
    const totals = calculateTotals(game.records);
    return { ...game, avg: totals.avg, ab: totals.ab, hits: totals.hits };
  });
}

function getGames(records) {
  const grouped = new Map();
  records.forEach((record) => {
    if (!record.date) return;
    const key = gameKey(record);
    if (!grouped.has(key)) {
      grouped.set(key, { key, date: record.date, opponent: record.opponent || "", records: [] });
    }
    grouped.get(key).records.push(record);
  });

  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date) || a.opponent.localeCompare(b.opponent, "zh-Hant"));
}

function gameLabel(game) {
  return `${formatChartDate(game.date)}${game.opponent ? `｜vs ${game.opponent}` : ""}`;
}

function gameKey(record) {
  return `${record.date || ""}__${record.opponent || ""}`;
}

function formatChartDate(date) {
  const parts = String(date).split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date;
}

function exportCsv() {
  const csv = [headers.join(","), ...state.records.map(toCsvRow)].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `softball-stats-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function importCsv(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(String(reader.result));
    const imported = rows.map(fromCsvRow).filter((record) => record.player && record.date);
    state.records = mergeRecords(imported, state.records);
    persist();
    render();
    event.target.value = "";
  };
  reader.readAsText(file);
}

async function pushToDrive() {
  const url = requireScriptUrl();
  if (!url) return;
  showStatus("正在上傳到 Google Sheet...");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "merge", records: state.records }),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "同步失敗");
    state.records = mergeRecords(result.records || [], state.records);
    persist();
    render();
    showStatus(`已同步 ${state.records.length} 筆紀錄到 Google Drive。`);
  } catch (error) {
    showStatus(`上傳失敗：${error.message}`, true);
  }
}

async function pullFromDrive(options = {}) {
  const url = options.silent ? scriptUrlInput.value.trim() : requireScriptUrl();
  if (!url) return;
  if (!options.silent) showStatus("正在從 Google Sheet 下載...");
  try {
    const response = await fetch(`${url}?action=list`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "下載失敗");
    const beforeCount = state.records.length;
    state.records = mergeRecords(result.records || [], state.records);
    persist();
    render();
    if (!options.silent || state.records.length !== beforeCount) {
      showStatus(`已更新全隊紀錄，目前共 ${state.records.length} 筆。`);
    }
  } catch (error) {
    if (!options.silent) showStatus(`下載失敗：${error.message}`, true);
  }
}

async function autoSyncRecord(record) {
  const url = scriptUrlInput.value.trim();
  if (!url) {
    showStatus("已存在本機。貼上 Google Apps Script URL 後會自動同步全隊資料。");
    return;
  }

  showStatus("已儲存，正在自動同步...");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "merge", records: [record] }),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "同步失敗");
    state.records = mergeRecords(result.records || [], state.records);
    persist();
    render();
    showStatus(`已自動同步，全隊目前 ${state.records.length} 筆紀錄。`);
  } catch (error) {
    showStatus(`已存在本機，但自動同步失敗：${error.message}`, true);
  }
}

async function autoDeleteRecord(id) {
  const url = scriptUrlInput.value.trim();
  if (!url) return;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "delete", id }),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "刪除失敗");
    state.records = mergeRecords(result.records || [], state.records).filter((record) => record.id !== id);
    persist();
    render();
    showStatus("已刪除並同步到 Google Sheet。");
  } catch (error) {
    showStatus(`已刪除本機紀錄，但雲端刪除失敗：${error.message}`, true);
  }
}

function requireScriptUrl() {
  const url = scriptUrlInput.value.trim();
  if (!url) {
    showStatus("請先貼上 Google Apps Script Web App URL。", true);
    return "";
  }
  localStorage.setItem(SCRIPT_URL_KEY, url);
  return url;
}

function showStatus(message, isError = false) {
  syncStatus.textContent = message;
  syncStatus.style.borderColor = isError ? "rgba(180, 61, 61, 0.45)" : "var(--line)";
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function rate(value) {
  const fixed = Number.isFinite(value) ? value.toFixed(3) : "0.000";
  return fixed.replace(/^0/, "");
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function number(value) {
  return Number(value || 0);
}

function clean(value) {
  return String(value || "").trim();
}

function toCsvRow(record) {
  return headers.map((header) => csvEscape(record[header] ?? "")).join(",");
}

function fromCsvRow(row) {
  const record = {};
  headers.forEach((header, index) => {
    record[header] = row[index] || "";
  });
  record.id = record.id || crypto.randomUUID();
  fields.forEach((field) => {
    record[field] = number(record[field]);
  });
  return record;
}

function summarizeLegacyOutcome(record) {
  if (number(record.hr)) return "全壘打";
  if (number(record.triple)) return "三安";
  if (number(record.double)) return "二安";
  if (number(record.single)) return "一安";
  if (number(record.bb)) return "保送";
  if (number(record.sf)) return "犧飛";
  if (number(record.error)) return "失誤上壘";
  return "出局";
}

function csvEscape(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const first = rows[0] || [];
  return first.join(",") === headers.join(",") ? rows.slice(1) : rows;
}

function mergeRecords(primary, secondary) {
  const seen = new Set();
  return [...primary, ...secondary].filter((record) => {
    const id = record.id || crypto.randomUUID();
    record.id = id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
