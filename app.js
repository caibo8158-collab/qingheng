import { sharedFoodApiUrl } from "./config.js";

const STORAGE_KEY = "qingheng.v1";

/**
 * @typedef {{ date: string, weight: number, note?: string, updatedAt: string }} Entry
 * @typedef {{ name: string, amount?: string, calories: number, protein: number, fat: number, carbs: number }} FoodItem
 * @typedef {{ id: string, date: string, rawText: string, foods: FoodItem[], totals: Omit<FoodItem, 'name'|'amount'>, createdAt: string }} Meal
 * @typedef {{ goal: number | null, entries: Entry[], meals: Meal[] }} Store
 */

const els = {
  date: document.getElementById("entry-date"),
  weight: document.getElementById("weight-input"),
  note: document.getElementById("note-input"),
  saveBtn: document.getElementById("save-btn"),
  feedback: document.getElementById("save-feedback"),
  latest: document.getElementById("stat-latest"),
  delta: document.getElementById("stat-delta"),
  goal: document.getElementById("stat-goal"),
  goalBtn: document.getElementById("goal-btn"),
  goalDialog: document.getElementById("goal-dialog"),
  goalForm: document.getElementById("goal-form"),
  goalInput: document.getElementById("goal-input"),
  chart: document.getElementById("chart"),
  chartEmpty: document.getElementById("chart-empty"),
  historyList: document.getElementById("history-list"),
  historyEmpty: document.getElementById("history-empty"),
  historyCount: document.getElementById("history-count"),
  exportBtn: document.getElementById("export-btn"),
  importInput: document.getElementById("import-input"),
  chatLog: document.getElementById("chat-log"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  chatSend: document.getElementById("chat-send"),
  chatHint: document.getElementById("chat-hint"),
  mealList: document.getElementById("meal-list"),
  todayKcal: document.getElementById("today-kcal"),
  todayProtein: document.getElementById("today-protein"),
  todayFat: document.getElementById("today-fat"),
  todayCarbs: document.getElementById("today-carbs"),
};

let range = "7";
/** @type {Store} */
let store = loadStore();
let chatBusy = false;

const FOOD_SYSTEM_PROMPT = `你是饮食营养估算助手。用户会用中文描述吃了什么。
请估算每样食物的营养，只返回 JSON，不要 Markdown，不要解释。
格式：
{"foods":[{"name":"食物名","amount":"分量","calories":数字,"protein":数字,"fat":数字,"carbs":数字}]}
规则：
- calories 单位 kcal，protein/fat/carbs 单位克，保留 1 位小数
- 若有多道食物就拆成多项
- 分量不明确时按常见家常分量估算
- 无法识别时返回 {"foods":[],"error":"原因"}`;

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMeal(m) {
  if (!m || !Array.isArray(m.foods)) return null;
  const foods = m.foods
    .filter((f) => f && typeof f.name === "string")
    .map((f) => ({
      name: String(f.name),
      amount: typeof f.amount === "string" ? f.amount : "",
      calories: Number(f.calories) || 0,
      protein: Number(f.protein) || 0,
      fat: Number(f.fat) || 0,
      carbs: Number(f.carbs) || 0,
    }));
  const totals = foods.reduce(
    (acc, f) => ({
      calories: acc.calories + f.calories,
      protein: acc.protein + f.protein,
      fat: acc.fat + f.fat,
      carbs: acc.carbs + f.carbs,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );
  return {
    id: typeof m.id === "string" ? m.id : uid(),
    date: typeof m.date === "string" ? m.date : todayISO(),
    rawText: typeof m.rawText === "string" ? m.rawText : "",
    foods,
    totals: {
      calories: round1(totals.calories),
      protein: round1(totals.protein),
      fat: round1(totals.fat),
      carbs: round1(totals.carbs),
    },
    createdAt: m.createdAt || new Date().toISOString(),
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { goal: null, entries: [], meals: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { goal: null, entries: [], meals: [] };
    }
    return {
      goal: typeof parsed.goal === "number" ? parsed.goal : null,
      entries: parsed.entries
        .filter((e) => e && typeof e.date === "string" && typeof e.weight === "number")
        .map((e) => ({
          date: e.date,
          weight: Number(e.weight),
          note: typeof e.note === "string" ? e.note : "",
          updatedAt: e.updatedAt || new Date().toISOString(),
        })),
      meals: Array.isArray(parsed.meals)
        ? parsed.meals.map(normalizeMeal).filter(Boolean)
        : [],
    };
  } catch {
    return { goal: null, entries: [], meals: [] };
  }
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function sortedEntries() {
  return [...store.entries].sort((a, b) => a.date.localeCompare(b.date));
}

function formatWeight(n) {
  return `${Number(n).toFixed(1)} kg`;
}

function formatDateLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const week = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  return `${m}/${d} 周${week}`;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function showFeedback(message, isError = false) {
  els.feedback.textContent = message;
  els.feedback.classList.toggle("is-error", isError);
  if (!message) return;
  window.clearTimeout(showFeedback._t);
  showFeedback._t = window.setTimeout(() => {
    els.feedback.textContent = "";
    els.feedback.classList.remove("is-error");
  }, 2200);
}

function upsertEntry(date, weight, note) {
  const idx = store.entries.findIndex((e) => e.date === date);
  const entry = {
    date,
    weight,
    note: note.trim(),
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) store.entries[idx] = entry;
  else store.entries.push(entry);
  saveStore();
}

function deleteEntry(date) {
  store.entries = store.entries.filter((e) => e.date !== date);
  saveStore();
  render();
  showFeedback("已删除该记录");
}

function fillFormForDate(date) {
  const existing = store.entries.find((e) => e.date === date);
  if (existing) {
    els.weight.value = String(existing.weight);
    els.note.value = existing.note || "";
  } else {
    const latest = sortedEntries().at(-1);
    els.weight.value = latest ? String(latest.weight) : "";
    els.note.value = "";
  }
}

function renderStats() {
  const entries = sortedEntries();
  const latest = entries.at(-1);
  const prev = entries.at(-2);

  els.latest.textContent = latest ? formatWeight(latest.weight) : "—";

  if (latest && prev) {
    const diff = latest.weight - prev.weight;
    const sign = diff > 0 ? "+" : "";
    els.delta.textContent = `${sign}${diff.toFixed(1)} kg`;
    els.delta.classList.toggle("down", diff < 0);
    els.delta.classList.toggle("up", diff > 0);
  } else {
    els.delta.textContent = "—";
    els.delta.classList.remove("down", "up");
  }

  if (store.goal != null) {
    if (latest) {
      const gap = latest.weight - store.goal;
      const sign = gap > 0 ? "+" : "";
      els.goal.textContent = `${store.goal.toFixed(1)}（${sign}${gap.toFixed(1)}）`;
    } else {
      els.goal.textContent = `${store.goal.toFixed(1)} kg`;
    }
  } else {
    els.goal.textContent = "未设";
  }
}

function entriesInRange() {
  const all = sortedEntries();
  if (range === "all") return all;
  const days = Number(range);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return all.filter((e) => {
    const [y, m, d] = e.date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt >= start && dt <= end;
  });
}

function drawChart() {
  const canvas = els.chart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = 200;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const data = entriesInRange();
  if (data.length < 2) {
    els.chartEmpty.classList.remove("hidden");
    return;
  }
  els.chartEmpty.classList.add("hidden");

  const pad = { top: 18, right: 16, bottom: 28, left: 42 };
  const w = cssW - pad.left - pad.right;
  const h = cssH - pad.top - pad.bottom;
  const weights = data.map((e) => e.weight);
  let min = Math.min(...weights);
  let max = Math.max(...weights);
  if (store.goal != null) {
    min = Math.min(min, store.goal);
    max = Math.max(max, store.goal);
  }
  const span = Math.max(max - min, 0.8);
  min -= span * 0.12;
  max += span * 0.12;

  const xAt = (i) => pad.left + (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w);
  const yAt = (v) => pad.top + ((max - v) / (max - min)) * h;

  ctx.strokeStyle = "rgba(20,53,47,0.08)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(61,92,85,0.75)";
  ctx.font = "11px 'Noto Sans SC', sans-serif";
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const y = pad.top + h * t;
    const val = max - (max - min) * t;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + w, y);
    ctx.stroke();
    ctx.fillText(val.toFixed(1), 6, y + 4);
  }

  if (store.goal != null) {
    const gy = yAt(store.goal);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(47,143,123,0.55)";
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(pad.left + w, gy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
  gradient.addColorStop(0, "rgba(47,143,123,0.28)");
  gradient.addColorStop(1, "rgba(47,143,123,0.02)");

  ctx.beginPath();
  data.forEach((e, i) => {
    const x = xAt(i);
    const y = yAt(e.weight);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#1a4d45";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.lineTo(xAt(data.length - 1), pad.top + h);
  ctx.lineTo(xAt(0), pad.top + h);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  data.forEach((e, i) => {
    const x = xAt(i);
    const y = yAt(e.weight);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#2f8f7b";
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  ctx.fillStyle = "rgba(61,92,85,0.8)";
  const labelIndexes =
    data.length <= 4
      ? data.map((_, i) => i)
      : [0, Math.floor((data.length - 1) / 2), data.length - 1];
  labelIndexes.forEach((i) => {
    const [, m, d] = data[i].date.split("-");
    const label = `${Number(m)}/${Number(d)}`;
    const x = xAt(i);
    ctx.fillText(label, x - 12, cssH - 8);
  });
}

function renderHistory() {
  const entries = [...sortedEntries()].reverse();
  els.historyCount.textContent = entries.length ? `${entries.length} 条` : "";
  els.historyList.innerHTML = "";

  entries.forEach((e) => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML = `
      <div class="history-meta">
        <div class="history-date">${formatDateLabel(e.date)}</div>
        ${e.note ? `<span class="history-note">${escapeHtml(e.note)}</span>` : ""}
      </div>
      <div class="history-weight">${e.weight.toFixed(1)} kg</div>
      <button class="delete-btn" type="button" aria-label="删除 ${e.date} 的记录" data-date="${e.date}">×</button>
    `;
    els.historyList.appendChild(li);
  });
}

function mealsToday() {
  const day = todayISO();
  return store.meals
    .filter((m) => m.date === day)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function sumTodayNutrition() {
  return mealsToday().reduce(
    (acc, m) => ({
      calories: acc.calories + m.totals.calories,
      protein: acc.protein + m.totals.protein,
      fat: acc.fat + m.totals.fat,
      carbs: acc.carbs + m.totals.carbs,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );
}

function renderNutrition() {
  const t = sumTodayNutrition();
  els.todayKcal.textContent = String(Math.round(t.calories));
  els.todayProtein.textContent = String(round1(t.protein));
  els.todayFat.textContent = String(round1(t.fat));
  els.todayCarbs.textContent = String(round1(t.carbs));
}

function formatFoodLine(f) {
  const amount = f.amount ? `（${f.amount}）` : "";
  return `${f.name}${amount} · ${round1(f.calories)} kcal · 蛋白 ${round1(f.protein)}g · 脂肪 ${round1(f.fat)}g · 碳水 ${round1(f.carbs)}g`;
}

function renderMeals() {
  const meals = [...mealsToday()].reverse();
  els.mealList.innerHTML = "";
  meals.forEach((m) => {
    const li = document.createElement("li");
    li.className = "meal-item";
    const foodsHtml = m.foods.map((f) => `<div class="meal-food">${escapeHtml(formatFoodLine(f))}</div>`).join("");
    li.innerHTML = `
      <div class="meal-main">
        <div class="meal-top">
          <strong>${escapeHtml(m.rawText || m.foods.map((f) => f.name).join("、"))}</strong>
          <span class="muted">${formatTime(m.createdAt)}</span>
        </div>
        ${foodsHtml}
        <div class="meal-total">合计 ${Math.round(m.totals.calories)} kcal</div>
      </div>
      <button class="delete-btn" type="button" data-meal-id="${m.id}" aria-label="删除这条饮食记录">×</button>
    `;
    els.mealList.appendChild(li);
  });
}

function appendChat(role, text, isError = false) {
  const div = document.createElement("div");
  div.className = `chat-bubble chat-${role}${isError ? " is-error" : ""}`;
  div.textContent = text;
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function setChatBusy(busy) {
  chatBusy = busy;
  els.chatSend.disabled = busy;
  els.chatInput.disabled = busy;
  els.chatSend.textContent = busy ? "识别中…" : "记录";
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function extractJson(text) {
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("模型未返回可解析的 JSON");
    return JSON.parse(match[0]);
  }
}

function hasSharedApi() {
  return Boolean(String(sharedFoodApiUrl || "").trim());
}

async function callFoodModel(userText) {
  if (!hasSharedApi()) {
    throw new Error("饮食识别服务暂时不可用，请稍后再试");
  }

  const messages = [
    { role: "system", content: FOOD_SYSTEM_PROMPT },
    { role: "user", content: userText },
  ];

  const res = await fetch(String(sharedFoodApiUrl).trim(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(res.ok ? "接口返回不是 JSON" : `请求失败（${res.status}）`);
  }

  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `请求失败（${res.status}）`;
    throw new Error(msg);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型没有返回内容");

  const parsed = extractJson(content);
  if (parsed.error && (!parsed.foods || !parsed.foods.length)) {
    throw new Error(parsed.error);
  }
  if (!Array.isArray(parsed.foods) || !parsed.foods.length) {
    throw new Error("没有识别到食物，请写得更具体一些");
  }

  return parsed.foods.map((f) => ({
    name: String(f.name || "食物").slice(0, 40),
    amount: String(f.amount || "").slice(0, 30),
    calories: round1(f.calories),
    protein: round1(f.protein),
    fat: round1(f.fat),
    carbs: round1(f.carbs),
  }));
}

function updateFoodHint() {
  els.chatHint.textContent = hasSharedApi()
    ? "用一句话说清食物和大概分量，AI 会估算营养并保存。"
    : "饮食识别服务暂时不可用。";
}

function saveMeal(rawText, foods) {
  const meal = normalizeMeal({
    id: uid(),
    date: todayISO(),
    rawText,
    foods,
    createdAt: new Date().toISOString(),
  });
  store.meals.push(meal);
  saveStore();
  return meal;
}

function deleteMeal(id) {
  store.meals = store.meals.filter((m) => m.id !== id);
  saveStore();
  renderFood();
}

function renderFood() {
  renderNutrition();
  renderMeals();
}

function render() {
  renderStats();
  drawChart();
  renderHistory();
  renderFood();
}

function onSave() {
  const date = els.date.value;
  const weight = Number(els.weight.value);
  const note = els.note.value || "";

  if (!date) {
    showFeedback("请选择日期", true);
    return;
  }
  if (!Number.isFinite(weight) || weight < 20 || weight > 300) {
    showFeedback("请输入有效体重（20–300 kg）", true);
    els.weight.focus();
    return;
  }

  const existed = store.entries.some((e) => e.date === date);
  upsertEntry(date, Math.round(weight * 10) / 10, note);
  render();
  showFeedback(existed ? "已更新当天记录" : "已保存");
}

async function onChatSubmit(e) {
  e.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text || chatBusy) return;

  if (!hasSharedApi()) {
    appendChat("assistant", "饮食识别服务暂时不可用，请稍后再试。", true);
    return;
  }

  appendChat("user", text);
  els.chatInput.value = "";
  setChatBusy(true);
  appendChat("assistant", "正在识别营养成分…");

  try {
    const foods = await callFoodModel(text);
    const meal = saveMeal(text, foods);
    const last = els.chatLog.querySelector(".chat-bubble:last-child");
    if (last) last.remove();
    const lines = meal.foods.map((f) => formatFoodLine(f)).join("\n");
    appendChat(
      "assistant",
      `已记录：\n${lines}\n合计 ${Math.round(meal.totals.calories)} kcal`
    );
    renderFood();
  } catch (err) {
    const last = els.chatLog.querySelector(".chat-bubble:last-child");
    if (last && last.textContent.includes("正在识别")) last.remove();
    const msg = err?.message || "识别失败";
    appendChat("assistant", msg, true);
    if (err?.name === "TypeError" || /Failed to fetch|NetworkError|CORS|跨域/i.test(msg)) {
      appendChat("assistant", "网络请求失败，请检查网络后重试。", true);
    }
  } finally {
    setChatBusy(false);
    els.chatInput.focus();
  }
}

function exportBackup() {
  const payload = {
    app: "轻衡",
    version: 2,
    exportedAt: new Date().toISOString(),
    data: store,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `qingheng-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showFeedback("备份已导出");
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const data = parsed.data || parsed;
    if (!data || !Array.isArray(data.entries)) {
      throw new Error("格式不正确");
    }
    const mealCount = Array.isArray(data.meals) ? data.meals.length : 0;
    const ok = window.confirm(
      `将导入 ${data.entries.length} 条体重、${mealCount} 条饮食，并覆盖当前数据。确定继续？`
    );
    if (!ok) return;
    store = {
      goal: typeof data.goal === "number" ? data.goal : null,
      entries: data.entries
        .filter((e) => e && e.date && typeof e.weight === "number")
        .map((e) => ({
          date: e.date,
          weight: Number(e.weight),
          note: typeof e.note === "string" ? e.note : "",
          updatedAt: e.updatedAt || new Date().toISOString(),
        })),
      meals: Array.isArray(data.meals)
        ? data.meals.map(normalizeMeal).filter(Boolean)
        : [],
    };
    saveStore();
    fillFormForDate(els.date.value);
    render();
    showFeedback("导入成功");
  } catch {
    showFeedback("导入失败，请检查备份文件", true);
  }
}

function init() {
  els.date.value = todayISO();
  fillFormForDate(els.date.value);

  els.date.addEventListener("change", () => fillFormForDate(els.date.value));
  els.saveBtn.addEventListener("click", onSave);
  els.weight.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSave();
  });

  document.querySelectorAll(".range-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      range = btn.dataset.range;
      document.querySelectorAll(".range-tab").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
      });
      drawChart();
    });
  });

  els.historyList.addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-btn");
    if (!btn) return;
    const date = btn.dataset.date;
    if (window.confirm(`删除 ${date} 的记录？`)) deleteEntry(date);
  });

  els.mealList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-meal-id]");
    if (!btn) return;
    if (window.confirm("删除这条饮食记录？")) deleteMeal(btn.dataset.mealId);
  });

  els.goalBtn.addEventListener("click", () => {
    els.goalInput.value = store.goal != null ? String(store.goal) : "";
    els.goalDialog.showModal();
  });

  els.goalForm.addEventListener("submit", (e) => {
    const submitter = e.submitter;
    const value = submitter ? submitter.value : "cancel";
    if (value === "save") {
      const n = Number(els.goalInput.value);
      if (!Number.isFinite(n) || n < 20 || n > 300) {
        e.preventDefault();
        showFeedback("目标体重无效", true);
        return;
      }
      store.goal = Math.round(n * 10) / 10;
      saveStore();
      render();
      showFeedback("目标已更新");
    } else if (value === "clear") {
      store.goal = null;
      saveStore();
      render();
      showFeedback("已清除目标");
    }
  });

  els.chatForm.addEventListener("submit", onChatSubmit);
  els.exportBtn.addEventListener("click", exportBackup);
  els.importInput.addEventListener("change", () => {
    const file = els.importInput.files?.[0];
    if (file) importBackup(file);
    els.importInput.value = "";
  });

  window.addEventListener("resize", () => drawChart());
  updateFoodHint();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
