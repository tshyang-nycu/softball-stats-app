const STORAGE_KEY = "softball-scorebook-records-v1";
const SCRIPT_URL_KEY = "softball-scorebook-script-url";
const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxTbbIrx6NoiDW0LMPOFO7zax0LUqlP2LCjw2WZTnd_rgu6VNO69TbzC_83SxwRtGpf7A/exec";

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
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const form = $("#recordForm");
const playerList = $("#playerList");
const gameFilter = $("#gameFilter");
const playerFilter = $("#playerFilter");
const recordsList = $("#recordsList");
const syncStatus = $("#syncStatus");
const avgTrendChart = $("#avgTrendChart");
const avgTrendEmpty = $("#avgTrendEmpty");
const avgTrendCurrent = $("#avgTrendCurrent");
const teamSplits = $("#teamSplits");

init();

function init() {
  form.elements.date.valueAsDate = new Date();

  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  form.addEventListener("submit", saveRecord);
  $("#clearFormButton").addEventListener("click", resetForm);
  $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#importCsvInput").addEventListener("change", importCsv);
  $("#pushButton").addEventListener("click", pushToDrive);
  $("#pullButton").addEventListener("click", pullFromDrive);
  gameFilter.addEventListener("change", () => {
    renderPlayers();
    renderStats();
  });
  playerFilter.addEventListener("change", renderStats);
  window.addEventListener("resize", () => {
    if ($("#statsView").classList.contains("active")) renderStats();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js");
  }

  render();
  pullFromDrive({ silent: true });
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
  showStatus("已儲存在本機。上傳前若按更新最新資料，雲端資料會覆蓋本機。");
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
    node.querySelector(".record-meta").textContent = `${normalizeDateValue(record.date)}${record.inning ? `｜${record.inning}局` : ""}｜vs ${record.opponent || "未填對手"}`;
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
  showStatus("已刪除本機紀錄。若要更新雲端資料，請到同步頁重新上傳。");
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
  gradient.addColorStop(0, "rgba(185, 151, 69, 0.28)");
  gradient.addColorStop(1, "rgba(185, 151, 69, 0)");

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
  context.strokeStyle = "#5b2ea6";
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();

  points.forEach((point) => {
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#5b2ea6";
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
    record.date = normalizeDateValue(record.date);
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
  return `${normalizeDateValue(record.date)}__${record.opponent || ""}`;
}

function formatChartDate(date) {
  const normalized = normalizeDateValue(date);
  const parts = normalized.split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : normalized;
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
  const game = getCurrentUploadGame();
  if (!game) {
    showStatus("目前沒有可上傳的本次比賽資料。", true);
    return;
  }

  showStatus(`正在上傳 ${gameLabel(game)} 的 ${game.records.length} 筆紀錄...`);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "merge", records: game.records }),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "同步失敗");
    state.records = mergeRecords(result.records || [], state.records);
    persist();
    render();
    showStatus(`已上傳 ${gameLabel(game)}，全隊目前共 ${state.records.length} 筆紀錄。`);
  } catch (error) {
    showStatus(`上傳失敗：${error.message}`, true);
  }
}

async function pullFromDrive(options = {}) {
  const url = requireScriptUrl();
  if (!url) return;
  if (!options.silent) showStatus("正在用雲端資料覆蓋本機...");
  try {
    const response = await fetch(`${url}?action=list`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "下載失敗");
    state.records = normalizeRecords(result.records || []);
    persist();
    render();
    if (!options.silent) showStatus(`已用雲端資料覆蓋本機，目前共 ${state.records.length} 筆。`);
  } catch (error) {
    if (!options.silent) showStatus(`更新失敗：${error.message}`, true);
  }
}

function getCurrentUploadGame() {
  const games = getGames(state.records);
  if (!games.length) return null;

  if (gameFilter.value && gameFilter.value !== "__all__") {
    return games.find((game) => game.key === gameFilter.value) || null;
  }

  const formKey = gameKey({
    date: form.elements.date.value,
    opponent: clean(form.elements.opponent.value),
  });
  return games.find((game) => game.key === formKey) || games[games.length - 1];
}

function requireScriptUrl() {
  const url = getConfiguredScriptUrl();
  if (!url) {
    showStatus("請先在 app.js 設定 DEFAULT_SCRIPT_URL。", true);
    return "";
  }
  if (!DEFAULT_SCRIPT_URL) localStorage.setItem(SCRIPT_URL_KEY, url);
  return url;
}

function getConfiguredScriptUrl() {
  return DEFAULT_SCRIPT_URL || localStorage.getItem(SCRIPT_URL_KEY) || "";
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
  record.date = normalizeDateValue(record.date);
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
  return normalizeRecords([...primary, ...secondary]).filter((record) => {
    const id = record.id || crypto.randomUUID();
    record.id = id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizeRecords(records) {
  return records.map((record) => {
    const normalized = { ...record };
    normalized.id = normalized.id || crypto.randomUUID();
    normalized.date = normalizeDateValue(normalized.date);
    fields.forEach((field) => {
      normalized[field] = number(normalized[field]);
    });
    return normalized;
  });
}

function normalizeDateValue(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;

  const slashMatch = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slashMatch) return `${slashMatch[1]}-${slashMatch[2].padStart(2, "0")}-${slashMatch[3].padStart(2, "0")}`;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
