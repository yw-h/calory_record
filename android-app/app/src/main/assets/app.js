const STORAGE_KEY = "daily-nutrition-ledger:v1";

const goalCopy = {
  cut: "减脂",
  gain: "增肌",
  maintain: "维持",
};

const paceAdjustments = {
  cut: { mild: -300, standard: -500, aggressive: -750 },
  gain: { mild: 150, standard: 250, aggressive: 400 },
  maintain: { mild: 0, standard: 0, aggressive: 0 },
};

const defaultState = {
  profile: null,
  api: {
    mode: "proxy",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiKey: "",
    aiMode: "fast",
    reasoningEffort: "high",
    showReasoning: false,
  },
  cloud: {
    url: "https://dav.jianguoyun.com/dav/",
    username: "",
    password: "",
    path: "/每日食谱记录/nutrition-ledger.json",
  },
  meals: [],
  deletedMeals: [],
  weights: [],
  activities: [],
  selectedDate: toDateKey(new Date()),
  dataUpdatedAt: null,
};

let state = loadState();
let pendingCoachAction = null;
let calendarCursor = startOfMonth(parseDateKey(state.selectedDate));
let cloudSyncTimer = null;
let isCloudSyncing = false;
let suppressCloudSync = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const isAndroidApp = () => Boolean(window.AndroidBridge?.request);

document.addEventListener("DOMContentLoaded", () => {
  if (isAndroidApp() && state.api.mode === "proxy") {
    state.api.mode = "direct";
    saveState({ touch: false, sync: false });
  }
  buildTodayLayout();
  bindEvents();
  hydrateForms();
  render();
  syncCloudOnStartup();

  if (!state.profile) {
    $("#profileDialog").showModal();
  }
});

function buildTodayLayout() {
  const todayPanel = $("#todayPanel");
  if (!todayPanel || todayPanel.querySelector(".today-layout")) return;

  const mealPanel = $("#mealForm")?.closest(".tool-panel");
  const weightPanel = $("#weightForm")?.closest(".tool-panel");
  const deficitPanel = $("#deficitChart")?.closest(".tool-panel");
  const logPanel = $("#mealList")?.closest(".tool-panel");
  const activityPanel = $("#activityForm")?.closest(".tool-panel");
  const bodyPanel = $("#weightChart")?.closest(".tool-panel");

  if (![mealPanel, weightPanel, deficitPanel, logPanel, activityPanel, bodyPanel].every(Boolean)) {
    return;
  }

  const layout = document.createElement("div");
  layout.className = "today-layout";

  const leftCol = document.createElement("div");
  leftCol.className = "today-col";
  leftCol.append(mealPanel, weightPanel, deficitPanel);

  const rightCol = document.createElement("div");
  rightCol.className = "today-col";
  rightCol.append(logPanel, activityPanel, bodyPanel);

  layout.append(leftCol, rightCol);
  todayPanel.replaceChildren(layout);
}

function bindEvents() {
  $("#recordDate").addEventListener("change", (event) => {
    state.selectedDate = event.target.value || toDateKey(new Date());
    calendarCursor = startOfMonth(parseDateKey(state.selectedDate));
    saveState({ touch: false, sync: false });
    render();
  });

  $("#prevMonthBtn").addEventListener("click", () => moveCalendarMonth(-1));
  $("#nextMonthBtn").addEventListener("click", () => moveCalendarMonth(1));
  $("#todayBtn").addEventListener("click", () => selectDate(toDateKey(new Date())));
  $("#openProfileBtn").addEventListener("click", () => switchTab("settings"));
  $("#jumpToProfileBtn").addEventListener("click", () => {
    $("#profileDialog").close();
    switchTab("settings");
  });

  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  $("#mealForm").addEventListener("submit", saveMeal);
  $("#estimateMealBtn").addEventListener("click", estimateMeal);
  $("#weightForm").addEventListener("submit", saveWeight);
  $("#activityForm").addEventListener("submit", saveActivity);
  $("#profileForm").addEventListener("submit", saveProfile);
  $("#apiForm").addEventListener("submit", saveApiSettings);
  $("#cloudForm").addEventListener("submit", saveCloudSettings);
  $("#trendRange").addEventListener("change", renderCharts);
  $("#askCoachBtn").addEventListener("click", () => runCoach("custom"));
  $("#exportDataBtn").addEventListener("click", exportData);
  $("#importDataInput").addEventListener("change", importData);
  $("#resetDataBtn").addEventListener("click", resetData);
  $$(".quick-actions [data-coach-action]").forEach((button) => {
    button.addEventListener("click", () => runCoach(button.dataset.coachAction));
  });

  window.addEventListener("resize", debounce(renderCharts, 160));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      api: { ...defaultState.api, ...(parsed.api || {}) },
      cloud: { ...defaultState.cloud, ...(parsed.cloud || {}) },
      meals: Array.isArray(parsed.meals) ? parsed.meals : [],
      deletedMeals: Array.isArray(parsed.deletedMeals) ? parsed.deletedMeals : [],
      weights: Array.isArray(parsed.weights) ? parsed.weights : [],
      activities: Array.isArray(parsed.activities) ? parsed.activities : [],
      selectedDate: parsed.selectedDate || toDateKey(new Date()),
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState(options = {}) {
  if (options.touch !== false) {
    state.dataUpdatedAt = new Date().toISOString();
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (options.sync !== false && !suppressCloudSync) {
    scheduleCloudSync();
  }
}

function hydrateForms() {
  $("#recordDate").value = state.selectedDate;
  hydrateProfileForm();
  hydrateApiForm();
  hydrateCloudForm();
}

function hydrateProfileForm() {
  const profile = state.profile || {};
  $("#profileHeight").value = profile.height || "";
  $("#profileWeight").value = profile.weight || "";
  $("#profileAge").value = profile.age || "";
  $("#profileGender").value = profile.gender || "male";
  $("#profileActivity").value = String(profile.activity || "1.375");
  $("#profileGoal").value = profile.goal || "cut";
  $("#profilePace").value = profile.pace || "standard";
  $("#profileTargetWeight").value = profile.targetWeight || "";
}

function hydrateApiForm() {
  $("#apiMode").value = state.api.mode || "proxy";
  $("#apiModel").value = state.api.model || "deepseek-v4-flash";
  $("#apiBaseUrl").value = state.api.baseUrl || "https://api.deepseek.com";
  $("#apiKey").value = state.api.apiKey || "";
  $("#aiMode").value = state.api.aiMode || "fast";
  $("#reasoningEffort").value = state.api.reasoningEffort || "high";
  $("#showReasoning").checked = Boolean(state.api.showReasoning);
}

function hydrateCloudForm() {
  $("#cloudUrl").value = state.cloud.url || "https://dav.jianguoyun.com/dav/";
  $("#cloudUsername").value = state.cloud.username || "";
  $("#cloudPassword").value = state.cloud.password || "";
  $("#cloudPath").value = state.cloud.path || "/每日食谱记录/nutrition-ledger.json";
  updateCloudStatus();
}

function render() {
  $("#recordDate").value = state.selectedDate;
  renderSummary();
  renderHomeCalendar();
  renderMeals();
  renderWeightForm();
  renderActivityForm();
  renderCharts();
  updateApiStatus();
}

function renderSummary() {
  const stats = getDayStats(state.selectedDate);
  const target = getTargets();
  const week = summarizeRange(getWeekDates(state.selectedDate));
  const month = summarizeRange(getMonthDates(state.selectedDate));
  const weightTrend = getWeightTrend();
  const activityAdjustedGoal = getActivityAdjustedGoal(stats, target);
  const remaining = activityAdjustedGoal - stats.calories;
  const progress = activityAdjustedGoal > 0 ? clamp((stats.calories / activityAdjustedGoal) * 100, 0, 140) : 0;
  const dailyDeficit = getRecordedDeficit(stats, target);

  $("#dailyIntake").textContent = `${round(stats.calories)} kcal`;
  $("#dailyMacroLine").textContent = `蛋白 ${round(stats.protein, 1)}g · 碳水 ${round(stats.carbs, 1)}g · 脂肪 ${round(stats.fat, 1)}g`;
  $("#dailyDeficit").textContent = stats.hasMeals ? formatSignedKcal(dailyDeficit, "缺口", "盈余") : "未记录";
  $("#dailyTargetLine").textContent = `目标热量 ${round(target.goalCalories)} kcal · 活动 ${round(stats.activityCalories)} kcal · 今日可用 ${round(activityAdjustedGoal)} kcal`;
  $("#weeklyDeficit").textContent = formatSignedKcal(week.deficit, "缺口", "盈余");
  $("#weeklyIntakeLine").textContent = `摄入 ${round(week.intake)} kcal · ${week.loggedDays} 天有记录`;
  $("#monthlyDeficit").textContent = formatSignedKcal(month.deficit, "缺口", "盈余");
  $("#weightTrendLine").textContent = weightTrend.label;
  $("#goalSummary").textContent = state.profile
    ? `${goalCopy[state.profile.goal]} · BMR ${round(target.bmr)} · TDEE ${round(target.tdee)}`
    : "请先完善身体档案";
  $("#remainingCalories").textContent = remaining >= 0 ? `还可摄入 ${round(remaining)} kcal` : `已超 ${round(Math.abs(remaining))} kcal`;
  $("#calorieProgress").style.width = `${progress}%`;
  $("#targetAdvice").textContent = buildTargetAdvice(stats, target);
}

function renderMeals() {
  const list = $("#mealList");
  const meals = getMealsForDate(state.selectedDate);

  if (!meals.length) {
    list.innerHTML = `<div class="empty-state">今天还没有餐食记录。先写下吃了什么，也可以让 AI 帮你估算。</div>`;
    return;
  }

  list.innerHTML = meals
    .map((meal) => {
      const macros = [
        meal.protein ? `蛋白 ${round(meal.protein, 1)}g` : null,
        meal.carbs ? `碳水 ${round(meal.carbs, 1)}g` : null,
        meal.fat ? `脂肪 ${round(meal.fat, 1)}g` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      return `
        <article class="meal-item">
          <div>
            <h3>${escapeHtml(meal.type)} · ${round(meal.calories)} kcal</h3>
            <p>${escapeHtml(meal.text)}</p>
            <div class="meal-meta">
              <span class="pill">${escapeHtml(meal.time || "")}</span>
              ${macros ? `<span class="pill">${escapeHtml(macros)}</span>` : ""}
              ${meal.aiConfidence ? `<span class="pill">AI 置信度 ${escapeHtml(meal.aiConfidence)}</span>` : ""}
            </div>
          </div>
          <button class="delete-meal" data-delete-meal="${meal.id}" type="button" aria-label="删除餐食">×</button>
        </article>
      `;
    })
    .join("");

  $$("[data-delete-meal]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteMeal(button.dataset.deleteMeal);
      saveState();
      render();
      showToast("已删除餐食记录");
    });
  });
}

function renderWeightForm() {
  const log = getWeightForDate(state.selectedDate);
  $("#weightValue").value = log?.weight || "";
  $("#weightNote").value = log?.note || "";
}

function renderActivityForm() {
  const activity = getActivityForDate(state.selectedDate);
  $("#activitySteps").value = activity?.steps || "";
  $("#activityType").value = activity?.type || "";
  $("#activityMinutes").value = activity?.minutes || "";
  $("#activityIntensity").value = activity?.intensity || "中";
  $("#activityCalories").value = activity?.calories || "";
  $("#activityNote").value = activity?.note || "";
  $("#activitySummary").textContent = activity
    ? `今日活动：${formatActivitySummary(activity)}`
    : "今天还没有活动量记录。";
}

function renderHomeCalendar() {
  const grid = $("#homeCalendarGrid");
  const todayKey = toDateKey(new Date());
  const dates = getWeekDates(state.selectedDate).map(parseDateKey);
  const weekStart = dates[0];
  const weekEnd = dates[dates.length - 1];

  $("#calendarMonthLabel").textContent = "本周记录";
  $("#selectedDateLabel").textContent = `${formatChineseDate(toDateKey(weekStart))} - ${formatChineseDate(toDateKey(weekEnd))}`;
  grid.classList.add("is-week-view");

  grid.innerHTML = dates
    .map((date) => {
      const dateKey = toDateKey(date);
      const stats = getDayStats(dateKey);
      const target = getTargets();
      const balance = getRecordedDeficit(stats, target);
      const isMuted = false;
      const isSelected = dateKey === state.selectedDate;
      const isToday = dateKey === todayKey;
      const className = [
        "calendar-day",
        isMuted ? "is-muted" : "",
        isSelected ? "is-selected" : "",
        isToday ? "is-today" : "",
        stats.hasMeals ? (balance >= 0 ? "good" : "over") : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <button class="${className}" data-calendar-date="${dateKey}" type="button">
          <span class="date-num">${date.getDate()}</span>
          <small>${stats.hasMeals ? formatCalendarCalorieDelta(-balance) : "未记录"}</small>
        </button>
      `;
    })
    .join("");

  $$("[data-calendar-date]").forEach((button) => {
    button.addEventListener("click", () => selectDate(button.dataset.calendarDate));
  });
}

function renderCharts() {
  renderDeficitChart();
  renderWeightChart();
}

function renderDeficitChart() {
  const canvas = $("#deficitChart");
  const ctx = fitCanvas(canvas);
  const days = Number($("#trendRange").value || 30);
  const dates = rangeBackFrom(state.selectedDate, days).reverse();
  const target = getTargets();
  const balances = dates.map((date) => getRecordedDeficit(getDayStats(date), target));
  const maxAbs = Math.max(500, ...balances.map((value) => Math.abs(value)));
  const width = canvas.logicalWidth || canvas.width;
  const height = canvas.logicalHeight || canvas.height;
  const padX = 38;
  const padTop = 54;
  const padBottom = 34;
  const chartW = width - padX * 2;
  const chartH = height - padTop - padBottom;
  const zeroY = padTop + chartH / 2;
  const slotW = chartW / dates.length;
  const barW = clamp(slotW * 0.5, 4, 18);

  clearChart(ctx, width, height);
  drawSoftGrid(ctx, width, height, { padX, padTop, padBottom, zeroY });

  balances.forEach((balance, index) => {
    if (!getDayStats(dates[index]).hasMeals) return;
    const x = padX + index * slotW + (slotW - barW) / 2;
    const barH = (Math.abs(balance) / maxAbs) * (chartH / 2 - 8);
    const y = balance >= 0 ? zeroY - barH : zeroY;
    ctx.fillStyle = balance >= 0 ? "rgba(31, 122, 90, 0.82)" : "rgba(215, 90, 67, 0.8)";
    roundRect(ctx, x, y, barW, Math.max(2, barH), Math.min(8, barW / 2));
    ctx.fill();
  });

  const loggedDays = dates.filter((date) => getDayStats(date).hasMeals).length;
  drawChartTitle(ctx, {
    title: `近 ${days} 天能量差额`,
    subtitle: `${formatSignedKcal(sum(balances), "缺口", "盈余")} · ${loggedDays} 天有记录`,
    x: padX,
    y: 26,
  });
}

function renderWeightChart() {
  const canvas = $("#weightChart");
  const ctx = fitCanvas(canvas);
  const days = Number($("#trendRange").value || 30);
  const start = addDays(parseDateKey(state.selectedDate), -days + 1);
  const logs = state.weights
    .filter((log) => parseDateKey(log.date) >= start && parseDateKey(log.date) <= parseDateKey(state.selectedDate))
    .sort((a, b) => a.date.localeCompare(b.date));
  const width = canvas.logicalWidth || canvas.width;
  const height = canvas.logicalHeight || canvas.height;
  const padX = 38;
  const padTop = 54;
  const padBottom = 38;

  clearChart(ctx, width, height);

  if (logs.length < 2) {
    $("#weightDeltaBadge").textContent = logs.length ? "需要更多记录" : "暂无变化";
    drawChartTitle(ctx, {
      title: "体重趋势",
      subtitle: "记录至少两次体重后显示变化",
      x: padX,
      y: 28,
    });
    drawEmptyChartState(ctx, width, height, "还需要更多体重记录");
    return;
  }

  const values = logs.map((log) => Number(log.weight));
  const min = Math.min(...values) - 0.4;
  const max = Math.max(...values) + 0.4;
  const chartW = width - padX * 2;
  const chartH = height - padTop - padBottom;
  const points = logs.map((log, index) => {
    const x = padX + (index / Math.max(logs.length - 1, 1)) * chartW;
    const y = padTop + ((max - log.weight) / Math.max(max - min, 1)) * chartH;
    return { x, y, log };
  });

  drawSoftGrid(ctx, width, height, { padX, padTop, padBottom });
  drawAreaUnderLine(ctx, points, height - padBottom, "rgba(36, 90, 159, 0.1)");
  ctx.strokeStyle = "#245a9f";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  drawSmoothLine(ctx, points);
  ctx.stroke();

  points.forEach((point) => {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#245a9f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  const delta = values[values.length - 1] - values[0];
  $("#weightDeltaBadge").textContent = `${delta >= 0 ? "+" : ""}${round(delta, 1)} kg`;
  drawChartTitle(ctx, {
    title: "体重趋势",
    subtitle: `${round(values[0], 1)} kg → ${round(values[values.length - 1], 1)} kg`,
    x: padX,
    y: 26,
  });
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = Math.max(320, Math.floor(rect.width));
  const cssHeight = Math.max(240, Math.floor(rect.height));
  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  canvas.logicalWidth = cssWidth;
  canvas.logicalHeight = cssHeight;
  return ctx;
}

function clearChart(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, width, height);
}

function drawSoftGrid(ctx, width, height, options = {}) {
  const padX = options.padX ?? 38;
  const padTop = options.padTop ?? 54;
  const padBottom = options.padBottom ?? 34;
  const chartH = height - padTop - padBottom;
  ctx.strokeStyle = "rgba(101, 114, 109, 0.16)";
  ctx.lineWidth = 1;
  for (let index = 0; index < 5; index += 1) {
    const y = padTop + index * (chartH / 4);
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(width - padX, y);
    ctx.stroke();
  }
  if (options.zeroY) {
    ctx.strokeStyle = "rgba(16, 34, 31, 0.28)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padX, options.zeroY);
    ctx.lineTo(width - padX, options.zeroY);
    ctx.stroke();
  }
}

function drawChartTitle(ctx, { title, subtitle, x, y }) {
  ctx.fillStyle = "#10221f";
  ctx.font = "700 17px sans-serif";
  ctx.fillText(title, x, y);
  ctx.fillStyle = "#65726d";
  ctx.font = "12px sans-serif";
  ctx.fillText(subtitle, x, y + 20);
}

function drawEmptyChartState(ctx, width, height, text) {
  ctx.fillStyle = "rgba(36, 90, 159, 0.08)";
  roundRect(ctx, width / 2 - 118, height / 2 - 30, 236, 60, 18);
  ctx.fill();
  ctx.fillStyle = "#65726d";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, width / 2, height / 2 + 5);
  ctx.textAlign = "left";
}

function drawAreaUnderLine(ctx, points, baseY, fillStyle) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, baseY);
  ctx.lineTo(points[0].x, points[0].y);
  drawSmoothLine(ctx, points, { continuePath: true });
  ctx.lineTo(points[points.length - 1].x, baseY);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function drawSmoothLine(ctx, points, options = {}) {
  if (!points.length) return;
  if (!options.continuePath) ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midX = (previous.x + current.x) / 2;
    ctx.bezierCurveTo(midX, previous.y, midX, current.y, current.x, current.y);
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  const top = height < 0 ? y + height : y;
  const h = Math.abs(height);
  ctx.beginPath();
  ctx.moveTo(x + r, top);
  ctx.lineTo(x + width - r, top);
  ctx.quadraticCurveTo(x + width, top, x + width, top + r);
  ctx.lineTo(x + width, top + h - r);
  ctx.quadraticCurveTo(x + width, top + h, x + width - r, top + h);
  ctx.lineTo(x + r, top + h);
  ctx.quadraticCurveTo(x, top + h, x, top + h - r);
  ctx.lineTo(x, top + r);
  ctx.quadraticCurveTo(x, top, x + r, top);
  ctx.closePath();
}

function saveMeal(event) {
  event.preventDefault();
  const text = $("#mealText").value.trim();
  const calories = Number($("#mealCalories").value);

  if (!text) {
    showToast("请先填写食物内容");
    return;
  }

  if (!Number.isFinite(calories) || calories <= 0) {
    showToast("请填写有效热量，或先使用 AI 估算");
    return;
  }

  state.meals.push({
    id: crypto.randomUUID(),
    date: state.selectedDate,
    time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    type: $("#mealType").value,
    text,
    calories,
    protein: numberOrZero($("#mealProtein").value),
    carbs: numberOrZero($("#mealCarbs").value),
    fat: numberOrZero($("#mealFat").value),
    updatedAt: new Date().toISOString(),
  });

  $("#mealForm").reset();
  $("#mealType").value = "早餐";
  saveState();
  render();
  showToast("餐食已保存");
}

function saveWeight(event) {
  event.preventDefault();
  const weight = Number($("#weightValue").value);

  if (!Number.isFinite(weight) || weight <= 0) {
    showToast("请填写有效体重");
    return;
  }

  state.weights = state.weights.filter((log) => log.date !== state.selectedDate);
  state.weights.push({
    date: state.selectedDate,
    weight,
    note: $("#weightNote").value.trim(),
    updatedAt: new Date().toISOString(),
  });

  if (state.profile) {
    state.profile.weight = weight;
    hydrateProfileForm();
  }

  saveState();
  render();
  showToast("体重已保存");
}

function saveActivity(event) {
  event.preventDefault();
  const steps = numberOrZero($("#activitySteps").value);
  const minutes = numberOrZero($("#activityMinutes").value);
  const manualCalories = numberOrNull($("#activityCalories").value);
  const type = $("#activityType").value.trim();
  const note = $("#activityNote").value.trim();

  if (!steps && !minutes && !manualCalories && !type && !note) {
    showToast("请至少填写一项活动量");
    return;
  }

  const activity = {
    date: state.selectedDate,
    steps,
    type,
    minutes,
    intensity: $("#activityIntensity").value,
    calories: manualCalories ?? estimateActivityCalories({ steps, minutes, intensity: $("#activityIntensity").value }),
    note,
    updatedAt: new Date().toISOString(),
  };

  state.activities = state.activities.filter((item) => item.date !== state.selectedDate);
  state.activities.push(activity);
  saveState();
  render();
  showToast("活动量已保存");
}

function saveProfile(event) {
  event.preventDefault();
  state.profile = {
    height: Number($("#profileHeight").value),
    weight: Number($("#profileWeight").value),
    age: Number($("#profileAge").value),
    gender: $("#profileGender").value,
    activity: Number($("#profileActivity").value),
    goal: $("#profileGoal").value,
    pace: $("#profilePace").value,
    targetWeight: numberOrNull($("#profileTargetWeight").value),
    updatedAt: new Date().toISOString(),
  };

  const hasTodayWeight = getWeightForDate(state.selectedDate);
  if (!hasTodayWeight) {
    state.weights.push({
      date: state.selectedDate,
      weight: state.profile.weight,
      note: "档案初始化",
      updatedAt: new Date().toISOString(),
    });
  }

  saveState();
  render();
  $("#profileDialog").close();
  showToast("身体档案已保存");
}

function saveApiSettings(event) {
  event.preventDefault();
  state.api = {
    mode: $("#apiMode").value,
    model: $("#apiModel").value.trim() || "deepseek-v4-flash",
    baseUrl: trimTrailingSlash($("#apiBaseUrl").value.trim() || "https://api.deepseek.com"),
    apiKey: $("#apiKey").value.trim(),
    aiMode: $("#aiMode").value,
    reasoningEffort: $("#reasoningEffort").value,
    showReasoning: $("#showReasoning").checked,
  };
  saveState({ touch: false, sync: false });
  updateApiStatus();
  showToast("API 设置已保存");
}

function saveCloudSettings(event) {
  event.preventDefault();
  state.cloud = {
    url: trimTrailingSlash($("#cloudUrl").value.trim() || "https://dav.jianguoyun.com/dav/"),
    username: $("#cloudUsername").value.trim(),
    password: $("#cloudPassword").value,
    path: normalizeCloudPath($("#cloudPath").value.trim() || "/每日食谱记录/nutrition-ledger.json"),
  };
  saveState({ touch: false, sync: false });
  updateCloudStatus();
  showToast("云同步配置已保存");
  syncCloudNow();
}

function scheduleCloudSync() {
  if (!ensureCloudReady({ silent: true })) return;
  window.clearTimeout(cloudSyncTimer);
  updateCloudStatus("等待同步");
  cloudSyncTimer = window.setTimeout(() => syncCloudNow(), 1200);
}

function syncCloudOnStartup() {
  if (!ensureCloudReady({ silent: true })) return;
  window.setTimeout(() => syncCloudNow({ startup: true }), 400);
}

async function syncCloudNow(options = {}) {
  if (!ensureCloudReady({ silent: options.startup })) return;
  if (isCloudSyncing) {
    scheduleCloudSync();
    return;
  }

  isCloudSyncing = true;
  updateCloudStatus("同步中");

  try {
    let remoteRaw = null;
    try {
      remoteRaw = await callCloudProxy("GET");
    } catch (error) {
      if (String(error.message).includes("404")) {
        await uploadCurrentStateToCloud();
        updateCloudStatus("已上传");
        if (!options.startup) showToast("已自动上传到云端");
        return;
      }
      throw error;
    }

    const remoteState = normalizeImportedState(remoteRaw);
    const localState = state;
    const mergedState = mergeStates(localState, remoteState);
    const localChanged = !areSyncPayloadsEqual(localState, mergedState);
    const remoteChanged = !areSyncPayloadsEqual(remoteState, mergedState);
    const localTime = getStateUpdatedTime(localState);
    const remoteTime = getStateUpdatedTime(remoteState);

    if (localChanged) {
      suppressCloudSync = true;
      state = {
        ...mergedState,
        dataUpdatedAt: getMergedDataUpdatedAt(localState, remoteState, mergedState, localChanged, remoteChanged),
      };
      calendarCursor = startOfMonth(parseDateKey(state.selectedDate || toDateKey(new Date())));
      saveState({ touch: false, sync: false });
      hydrateForms();
      render();
    }

    if (remoteChanged) {
      await uploadCurrentStateToCloud();
      updateCloudStatus(localChanged ? "已合并同步" : "已上传");
      if (!options.startup) {
        showToast(localChanged ? "已合并本地和云端数据" : "已自动上传到云端");
      }
      return;
    }

    if (localChanged || remoteTime > localTime) {
      updateCloudStatus("已拉取");
      if (!options.startup) showToast("已从云端同步最新数据");
      return;
    }

    updateCloudStatus("已同步");
  } catch (error) {
    updateCloudStatus("同步失败");
    showToast(error.message);
  } finally {
    suppressCloudSync = false;
    isCloudSyncing = false;
  }
}

async function uploadCurrentStateToCloud() {
  await callCloudProxy("PUT", createExportSnapshot());
}


async function estimateMeal() {
  const text = $("#mealText").value.trim();
  if (!text) {
    showToast("先写下需要估算的食物内容");
    return;
  }

  setBusy("#estimateMealBtn", true, "估算中");
  showEstimateLoading();
  try {
    const prompt = [
      "你是营养师。请估算这餐的总热量和三大营养素。",
      "只输出 JSON，不要 Markdown。",
      '格式：{"totalCalories":520,"protein":35,"carbs":55,"fat":15,"confidence":"中","notes":"估算依据"}',
      `餐食：${text}`,
    ].join("\n");
    const result = await callDeepSeek([{ role: "user", content: prompt }], { responseFormat: "json_object" });
    const parsed = parseJsonFromText(result);
    $("#mealCalories").value = parsed.totalCalories ?? parsed.calories ?? "";
    $("#mealProtein").value = parsed.protein ?? "";
    $("#mealCarbs").value = parsed.carbs ?? parsed.carbohydrates ?? "";
    $("#mealFat").value = parsed.fat ?? "";
    setMarkdownOutput("#aiOutput", parsed.notes || result);
    setEstimateStatus("估算完成", "已自动填入热量和三大营养素，可按需要微调后保存。", "success");
    $("#apiStatus").textContent = "已连接";
    showToast("AI 估算已填入表单");
  } catch (error) {
    showToast(error.message);
    setEstimateStatus("估算失败", error.message, "error");
    setMarkdownOutput("#aiOutput", `AI 估算失败：${error.message}`);
  } finally {
    setBusy("#estimateMealBtn", false, "AI 估算");
  }
}

function showEstimateLoading() {
  const thinkingText =
    state.api.aiMode === "deep"
      ? "DeepSeek 正在思考食材、份量和烹饪方式，thinking 模式可能需要更久。"
      : "正在估算这餐的热量和三大营养素。";
  $("#aiOutput").innerHTML = `
    <div class="loading-card" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      <div>
        <strong>正在估算中</strong>
        <p>${escapeHtml(thinkingText)}</p>
      </div>
    </div>
  `;
  setEstimateStatus("正在估算中", thinkingText, "loading");
}

function setEstimateStatus(title, message, stateName = "loading") {
  const status = ensureEstimateStatus();
  status.className = `estimate-status ${stateName}`;
  status.innerHTML = `
    ${stateName === "loading" ? '<span class="loading-spinner" aria-hidden="true"></span>' : ""}
    <div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function ensureEstimateStatus() {
  let status = $("#estimateStatus");
  if (status) return status;
  status = document.createElement("div");
  status.id = "estimateStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  $("#mealForm").before(status);
  return status;
}

async function runCoach(action) {
  pendingCoachAction = action;
  const question = $("#coachQuestion").value.trim();
  if (action === "custom" && !question) {
    showToast("请先填写自定义问题");
    return;
  }

  setBusy("#askCoachBtn", true, "思考中");
  $("#apiStatus").textContent = "请求中";
  setMarkdownOutput("#aiOutput", "DeepSeek 正在结合你的记录生成建议...");
  resetReasoningOutput();

  try {
    const prompt = buildCoachPrompt(action, question);
    const messages = [
      {
        role: "system",
        content:
          "你是严谨、务实的运动营养教练。请用中文回答，建议要可执行。不要替代医生诊断；遇到极端节食、疾病、孕期、进食障碍风险时提醒咨询专业人士。",
      },
      { role: "user", content: prompt },
    ];
    const waitingText = state.api.aiMode === "deep" && !state.api.showReasoning ? "DeepSeek 正在思考，最终建议会在生成后流式显示..." : "";
    setMarkdownOutput("#aiOutput", waitingText);
    let streamedText = "";
    let hasFirstContent = false;
    const outputWriter = createStreamWriter("#aiOutput", { markdown: true });
    const reasoningWriter = createStreamWriter("#reasoningOutput");
    await streamDeepSeek(
      messages,
      {
        onContent: (chunk) => {
          if (!hasFirstContent && waitingText) {
            setMarkdownOutput("#aiOutput", "");
          }
          hasFirstContent = true;
          streamedText += chunk;
          outputWriter.push(chunk);
        },
        onReasoning: (chunk) => appendReasoningChunk(chunk, reasoningWriter),
      },
      { maxTokens: 2400 }
    );
    outputWriter.flush();
    reasoningWriter.flush();
    if (!streamedText.trim()) {
      setMarkdownOutput("#aiOutput", "DeepSeek 没有返回内容");
    }
    $("#apiStatus").textContent = "已连接";
  } catch (error) {
    $("#apiStatus").textContent = "失败";
    setMarkdownOutput("#aiOutput", `请求失败：${error.message}\n\n如果你使用本地代理，请确认已经设置 DEEPSEEK_API_KEY 并运行 node server.js。`);
    showToast(error.message);
  } finally {
    pendingCoachAction = null;
    setBusy("#askCoachBtn", false, "询问 DeepSeek");
  }
}

async function callDeepSeek(messages, options = {}) {
  const model = state.api.model || "deepseek-v4-flash";
  const payload = {
    model,
    messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 1600,
  };
  applyThinkingOptions(payload, options);

  if (options.responseFormat) {
    payload.response_format = { type: options.responseFormat };
  }

  const response = await fetchDeepSeek(payload);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error?.message || data.message || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return data.choices?.[0]?.message?.content?.trim() || "DeepSeek 没有返回内容";
}

async function streamDeepSeek(messages, handlers = {}, options = {}) {
  if (isAndroidApp()) {
    const result = await callDeepSeek(messages, { ...options, maxTokens: options.maxTokens ?? 2400 });
    handlers.onContent?.(result);
    return;
  }

  const model = state.api.model || "deepseek-v4-flash";
  const payload = {
    model,
    messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 2400,
    stream: true,
  };
  applyThinkingOptions(payload, options);

  const response = await fetchDeepSeek(payload);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.error?.message || data.message || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  if (!response.body) {
    const data = await response.json().catch(() => ({}));
    handlers.onContent?.(data.choices?.[0]?.message?.content || "");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    processSseLines(lines, handlers);
  }

  if (buffer.trim()) {
    processSseLines([buffer], handlers);
  }
}

function processSseLines(lines, handlers = {}) {
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta || {};
      const message = parsed.choices?.[0]?.message || {};
      if (delta.reasoning_content || message.reasoning_content) {
        handlers.onReasoning?.(delta.reasoning_content || message.reasoning_content);
      }
      if (delta.content || message.content) {
        handlers.onContent?.(delta.content || message.content);
      }
    } catch {
      // Ignore partial or non-JSON SSE keepalive chunks.
    }
  }
}

function applyThinkingOptions(payload, options = {}) {
  const mode = options.aiMode || state.api.aiMode || "fast";
  if (mode === "deep") {
    payload.thinking = { type: "enabled" };
    payload.reasoning_effort = options.reasoningEffort || state.api.reasoningEffort || "high";
    return;
  }

  payload.thinking = { type: "disabled" };
}

function resetReasoningOutput() {
  $("#reasoningOutput").textContent = "";
  $("#reasoningBox").hidden = !(state.api.showReasoning && state.api.aiMode === "deep");
  $("#reasoningBox").open = false;
}

function appendReasoningChunk(chunk, writer) {
  if (!state.api.showReasoning || state.api.aiMode !== "deep") return;
  $("#reasoningBox").hidden = false;
  writer.push(chunk);
}

function createStreamWriter(selector, options = {}) {
  let queued = "";
  let rawText = options.initialText || "";
  let frame = null;
  const element = $(selector);

  const flush = () => {
    if (!queued) return;
    rawText += queued;
    queued = "";
    if (options.markdown) {
      element.innerHTML = renderMarkdown(rawText);
    } else {
      element.textContent = rawText;
    }
    element.scrollTop = element.scrollHeight;
    frame = null;
  };

  return {
    push(chunk) {
      queued += chunk;
      if (frame) return;
      frame = requestAnimationFrame(flush);
    },
    flush() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      flush();
    },
    reset() {
      rawText = "";
      queued = "";
      if (options.markdown) element.innerHTML = "";
      else element.textContent = "";
    },
  };
}

function setMarkdownOutput(selector, markdown) {
  $(selector).innerHTML = renderMarkdown(markdown || "");
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listType = null;
  let inCode = false;
  let codeLines = [];

  const closeParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${formatInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");

    if (line.trim().startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeParagraph();
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      closeParagraph();
      closeList();
      html.push(`<blockquote>${formatInline(quote[1])}</blockquote>`);
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (ordered || unordered) {
      closeParagraph();
      const nextType = ordered ? "ol" : "ul";
      if (listType !== nextType) {
        closeList();
        html.push(`<${nextType}>`);
        listType = nextType;
      }
      html.push(`<li>${formatInline((ordered || unordered)[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  closeParagraph();
  closeList();
  return html.join("");
}

function formatInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function fetchDeepSeek(payload) {
  if (isAndroidApp()) {
    const raw = window.AndroidBridge.request(
      JSON.stringify({
        type: "deepseek",
        ...payload,
        baseUrl: trimTrailingSlash(state.api.baseUrl),
        apiKey: state.api.apiKey,
      })
    );
    const parsed = JSON.parse(raw || "{}");
    return Promise.resolve({
      ok: !parsed.error,
      status: parsed.error?.status || 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => parsed,
      body: null,
    });
  }

  if (state.api.mode === "direct") {
    if (!state.api.apiKey) {
      throw new Error("直连模式需要填写 API Key");
    }

    return fetch(`${trimTrailingSlash(state.api.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.api.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  }

  return fetch("/api/deepseek/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      baseUrl: trimTrailingSlash(state.api.baseUrl),
    }),
  });
}

function buildCoachPrompt(action, question) {
  const target = getTargets();
  const todayStats = getDayStats(state.selectedDate);
  const week = summarizeRange(getWeekDates(state.selectedDate));
  const month = summarizeRange(getMonthDates(state.selectedDate));
  const recentMeals = getActiveMeals()
    .filter((meal) => rangeBackFrom(state.selectedDate, 7).includes(meal.date))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const recentWeights = state.weights
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-10);
  const recentActivities = state.activities
    .filter((activity) => rangeBackFrom(state.selectedDate, 7).includes(activity.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const requestMap = {
    today: "分析我今天已经记录的饮食进度，并给出后续餐次怎么吃。注意：如果今天只记录了早餐或午餐，不要把当前摄入低解读为失败，而是把它当作当天进度的一部分来安排后续。",
    tomorrow: "请为明天生成一份适合我目标的三餐一加餐食谱，给出每餐热量和蛋白质估算。",
    week: "请根据最近记录，给出未来 7 天饮食调整策略，重点关注热量缺口、体重趋势和可持续性。",
    custom: question,
  };

  return [
    `需求：${requestMap[action] || requestMap.today}`,
    "",
    "身体档案：",
    JSON.stringify(state.profile || {}, null, 2),
    "",
    "热量目标：",
    JSON.stringify(target, null, 2),
    "",
    `选中日期：${state.selectedDate}`,
    `当天统计：${JSON.stringify(todayStats, null, 2)}`,
    `本周统计：${JSON.stringify(week, null, 2)}`,
    `本月统计：${JSON.stringify(month, null, 2)}`,
    "",
    "近 7 天餐食：",
    JSON.stringify(recentMeals, null, 2),
    "",
    "近期体重：",
    JSON.stringify(recentWeights, null, 2),
    "",
    "近 7 天活动量：",
    JSON.stringify(recentActivities, null, 2),
    "",
    "语气与判断规则：",
    "1. 如果选中日期是今天，或当天记录餐次少于 3 餐，不要使用“远低于目标”“偏离目标较大”“不符合目标”“明显不足”等让人不舒服的开头。",
    "2. 对未完成的一天，先说“目前进度”，再说“后续怎么安排”，不要把早餐/午餐后的低摄入当作全天结论。",
    "3. 开头建议使用温和、行动导向的句式，例如：“目前记录还不完整，后面重点补足蛋白和适量主食即可。”",
    "4. 只有在一天已基本记录完整且摄入确实超出或严重不足时，才评价是否符合目标；否则只给阶段性建议。",
    "5. 避免羞辱、责备和夸张措辞；用“还可以补”“建议接下来安排”“今天后面可以这样吃”替代“远低于/偏离/失败”。",
    "",
    "输出要求：",
    "1. 先给一句温和结论：如果记录不完整，结论必须是阶段性进度，而不是全天达标/不达标评价。",
    "2. 给 3-5 条具体建议，包含下一餐或今晚可吃的食物、克重、热量和蛋白质估算。",
    "3. 减脂时避免低于基础代谢太多；增肌或力量训练日关注蛋白和训练日碳水。",
    "4. 如果数据不足，请用友好方式说明还需要记录什么，并继续给可执行建议。",
    "5. 回答要完整但克制：最多给 2 套餐食方案和 1 条训练/加餐建议，不要展开过长；最后用一句话收尾，不要停在半句。",
  ].join("\n");
}

function getTargets() {
  if (!state.profile) {
    return {
      bmr: 0,
      tdee: 0,
      goalCalories: 0,
      proteinTarget: 0,
      fatTarget: 0,
      carbTarget: 0,
    };
  }

  const weight = getLatestWeight()?.weight || state.profile.weight;
  const { height, age, gender, activity, goal, pace } = state.profile;
  const genderOffset = gender === "male" ? 5 : gender === "female" ? -161 : -78;
  const bmr = 10 * weight + 6.25 * height - 5 * age + genderOffset;
  const tdee = bmr * Number(activity || 1.2);
  const adjustment = paceAdjustments[goal]?.[pace] ?? 0;
  const goalCalories = Math.max(1200, tdee + adjustment);
  const proteinMultiplier = goal === "gain" ? 2 : goal === "cut" ? 1.8 : 1.5;
  const proteinTarget = weight * proteinMultiplier;
  const fatTarget = weight * 0.8;
  const carbTarget = Math.max(0, (goalCalories - proteinTarget * 4 - fatTarget * 9) / 4);

  return {
    bmr,
    tdee,
    goalCalories,
    proteinTarget,
    fatTarget,
    carbTarget,
    adjustment,
  };
}

function getDayStats(date) {
  const meals = getMealsForDate(date);
  const activity = getActivityForDate(date);
  return {
    date,
    calories: sum(meals.map((meal) => Number(meal.calories) || 0)),
    protein: sum(meals.map((meal) => Number(meal.protein) || 0)),
    carbs: sum(meals.map((meal) => Number(meal.carbs) || 0)),
    fat: sum(meals.map((meal) => Number(meal.fat) || 0)),
    mealCount: meals.length,
    hasMeals: meals.length > 0,
    activityCalories: Number(activity?.calories) || 0,
    steps: Number(activity?.steps) || 0,
    activityMinutes: Number(activity?.minutes) || 0,
    activityType: activity?.type || "",
  };
}

function getRecordedDeficit(stats, target) {
  return stats.hasMeals ? getActivityAdjustedGoal(stats, target) - stats.calories : 0;
}

function getActivityAdjustedGoal(stats, target) {
  return target.goalCalories + (Number(stats.activityCalories) || 0);
}

function summarizeRange(dates) {
  const target = getTargets();
  const dayStats = dates.map(getDayStats);
  const recordedDays = dayStats.filter((day) => day.hasMeals);
  const intake = sum(recordedDays.map((day) => day.calories));
  const deficit = sum(recordedDays.map((day) => getRecordedDeficit(day, target)));
  const targetCalories = sum(recordedDays.map((day) => getActivityAdjustedGoal(day, target)));
  return {
    intake,
    deficit,
    targetCalories,
    loggedDays: recordedDays.length,
    days: dates.length,
  };
}

function buildTargetAdvice(stats, target) {
  if (!state.profile) return "完善身体档案后生成目标建议。";
  const remaining = getActivityAdjustedGoal(stats, target) - stats.calories;
  const proteinGap = target.proteinTarget - stats.protein;
  const proteinText = proteinGap > 0 ? `蛋白还差约 ${round(proteinGap)}g` : "蛋白已达标";
  const activityText = stats.activityCalories ? `今日活动约消耗 ${round(stats.activityCalories)} kcal，` : "";
  if (remaining >= 0) {
    return `${activityText}距目标还可摄入 ${round(remaining)} kcal，${proteinText}。优先补足优质蛋白和蔬菜。`;
  }
  return `${activityText}今天已超过目标 ${round(Math.abs(remaining))} kcal，${proteinText}。下一餐建议降低油脂和精制碳水。`;
}

function getMealsForDate(date) {
  return getActiveMeals().filter((meal) => meal.date === date).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

function getActiveMeals(candidate = state) {
  const deleted = new Set((candidate.deletedMeals || []).map((item) => item.id));
  return (candidate.meals || []).filter((meal) => meal.id ? !deleted.has(meal.id) : true);
}

function deleteMeal(mealId) {
  if (!mealId) return;
  const meal = state.meals.find((item) => item.id === mealId);
  const deletedAt = new Date().toISOString();
  state.meals = state.meals.filter((item) => item.id !== mealId);
  state.deletedMeals = mergeDeletedMeals(state.deletedMeals, [{ id: mealId, deletedAt, updatedAt: deletedAt, date: meal?.date }]);
}

function getActivityForDate(date) {
  return state.activities.find((activity) => activity.date === date);
}

function getWeightForDate(date) {
  return state.weights.find((log) => log.date === date);
}

function getLatestWeight() {
  return state.weights
    .filter((log) => parseDateKey(log.date) <= parseDateKey(state.selectedDate))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

function getWeightTrend() {
  const logs = state.weights.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!logs.length) return { label: "体重暂无记录", delta: 0 };
  if (logs.length === 1) return { label: `当前 ${round(logs[0].weight, 1)} kg`, delta: 0 };
  const first = logs[0];
  const last = logs[logs.length - 1];
  const delta = Number(last.weight) - Number(first.weight);
  return {
    label: `体重 ${delta >= 0 ? "+" : ""}${round(delta, 1)} kg · 当前 ${round(last.weight, 1)} kg`,
    delta,
  };
}

function getWeekDates(dateKey) {
  const date = parseDateKey(dateKey);
  const day = date.getDay() || 7;
  const monday = addDays(date, 1 - day);
  return Array.from({ length: 7 }, (_, index) => toDateKey(addDays(monday, index)));
}

function getMonthDates(dateKey) {
  const date = parseDateKey(dateKey);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const dates = [];
  for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
    dates.push(toDateKey(cursor));
  }
  return dates;
}

function rangeBackFrom(dateKey, days) {
  const end = parseDateKey(dateKey);
  return Array.from({ length: days }, (_, index) => toDateKey(addDays(end, index - days + 1)));
}

function moveSelectedDate(delta) {
  selectDate(toDateKey(addDays(parseDateKey(state.selectedDate), delta)));
}

function moveCalendarMonth(delta) {
  state.selectedDate = toDateKey(addDays(parseDateKey(state.selectedDate), delta * 7));
  calendarCursor = startOfMonth(parseDateKey(state.selectedDate));
  saveState({ touch: false, sync: false });
  render();
}

function selectDate(dateKey) {
  state.selectedDate = dateKey;
  calendarCursor = startOfMonth(parseDateKey(dateKey));
  saveState({ touch: false, sync: false });
  render();
}

function switchTab(tab) {
  $$(".tab-button").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === tab));
  $$(".tab-panel").forEach((panel) => panel.classList.remove("is-active"));
  $(`#${tab}Panel`).classList.add("is-active");
  if (tab === "settings") hydrateProfileForm();
  renderCharts();
}

function updateApiStatus() {
  const status = state.api.mode === "proxy" ? "本地代理" : state.api.apiKey ? "直连已配置" : "未配置 Key";
  $("#apiStatus").textContent = status;
}

function updateCloudStatus(text) {
  const ready = state.cloud?.url && state.cloud?.username && state.cloud?.password && state.cloud?.path;
  $("#cloudStatus").textContent = text || (ready ? "已配置" : "未配置");
}

function setBusy(selector, busy, text) {
  const button = $(selector);
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
  button.setAttribute("aria-busy", String(busy));
  button.innerHTML = busy
    ? `<span class="button-spinner" aria-hidden="true"></span><span>${escapeHtml(text)}</span>`
    : escapeHtml(text);
}

function ensureCloudReady(options = {}) {
  const cloud = state.cloud || {};
  if (!cloud.url || !cloud.username || !cloud.password || !cloud.path) {
    if (!options.silent) showToast("请先保存云同步配置");
    updateCloudStatus("未配置");
    return false;
  }
  return true;
}

async function callCloudProxy(method, data) {
  if (isAndroidApp()) {
    const raw = window.AndroidBridge.request(
      JSON.stringify({
        type: "cloud",
        method,
        cloud: state.cloud,
        data,
      })
    );
    const parsed = JSON.parse(raw || "{}");
    if (parsed.error) throw new Error(parsed.error.message || "云同步失败");
    return parsed;
  }

  const response = await fetch("/api/cloud/webdav", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method,
      cloud: state.cloud,
      data,
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `云同步失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function exportData() {
  const blob = new Blob([JSON.stringify(createExportSnapshot(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `每日食谱记录-${toDateKey(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    state = normalizeImportedState(imported);
    calendarCursor = startOfMonth(parseDateKey(state.selectedDate || toDateKey(new Date())));
    saveState();
    hydrateForms();
    render();
    showToast("数据已导入");
  } catch {
    showToast("导入失败，请确认 JSON 格式正确");
  } finally {
    event.target.value = "";
  }
}

function createExportSnapshot() {
  const api = { ...state.api, apiKey: "" };
  const cloud = { ...state.cloud, password: "" };
  return {
    ...state,
    api,
    cloud,
    dataUpdatedAt: state.dataUpdatedAt || new Date().toISOString(),
    exportedAt: new Date().toISOString(),
    appVersion: "daily-nutrition-ledger:v1",
  };
}

function normalizeImportedState(imported) {
  return {
    ...structuredClone(defaultState),
    ...imported,
    api: { ...defaultState.api, ...(imported.api || {}), apiKey: state.api?.apiKey || imported.api?.apiKey || "" },
    cloud: { ...defaultState.cloud, ...(imported.cloud || {}), ...(state.cloud || {}) },
    meals: Array.isArray(imported.meals) ? imported.meals : [],
    deletedMeals: Array.isArray(imported.deletedMeals) ? imported.deletedMeals : [],
    weights: Array.isArray(imported.weights) ? imported.weights : [],
    activities: Array.isArray(imported.activities) ? imported.activities : [],
    selectedDate: imported.selectedDate || toDateKey(new Date()),
    dataUpdatedAt: imported.dataUpdatedAt || imported.exportedAt || null,
  };
}

function mergeStates(localState, remoteState) {
  return {
    ...localState,
    profile: pickNewerByUpdatedAt(localState.profile, remoteState.profile) || localState.profile || remoteState.profile,
    api: { ...defaultState.api, ...(localState.api || {}) },
    cloud: { ...defaultState.cloud, ...(localState.cloud || {}) },
    meals: mergeActiveMeals(localState, remoteState),
    deletedMeals: mergeDeletedMeals(localState.deletedMeals, remoteState.deletedMeals),
    weights: mergeByKey(localState.weights, remoteState.weights, (weight) => weight.date, pickNewerByUpdatedAt),
    activities: mergeByKey(localState.activities, remoteState.activities, (activity) => activity.date, pickNewerByUpdatedAt),
    selectedDate: localState.selectedDate || remoteState.selectedDate || toDateKey(new Date()),
    dataUpdatedAt: getStateUpdatedTime(localState) >= getStateUpdatedTime(remoteState) ? localState.dataUpdatedAt : remoteState.dataUpdatedAt,
  };
}

function getMergedDataUpdatedAt(localState, remoteState, mergedState, localChanged, remoteChanged) {
  if (localChanged && remoteChanged) return new Date().toISOString();
  if (localChanged) {
    const remoteTime = getStateUpdatedTime(remoteState);
    return remoteState.dataUpdatedAt || (remoteTime ? new Date(remoteTime).toISOString() : new Date().toISOString());
  }
  const winner = getStateUpdatedTime(remoteState) > getStateUpdatedTime(localState) ? remoteState : localState;
  const mergedTime = getStateUpdatedTime(mergedState);
  return winner?.dataUpdatedAt || mergedState.dataUpdatedAt || (mergedTime ? new Date(mergedTime).toISOString() : new Date().toISOString());
}

function getStateUpdatedTime(candidate) {
  if (!candidate) return 0;
  const direct = Date.parse(candidate.dataUpdatedAt || candidate.exportedAt || 0) || 0;
  const itemTimes = [
    candidate.profile?.updatedAt,
    ...(candidate.meals || []).map((item) => item.updatedAt || item.date),
    ...(candidate.deletedMeals || []).map((item) => item.updatedAt || item.deletedAt || item.date),
    ...(candidate.weights || []).map((item) => item.updatedAt || item.date),
    ...(candidate.activities || []).map((item) => item.updatedAt || item.date),
  ].map((value) => Date.parse(value || 0) || 0);
  return Math.max(direct, ...itemTimes, 0);
}

function areSyncPayloadsEqual(a, b) {
  return stableStringify(getSyncPayload(a)) === stableStringify(getSyncPayload(b));
}

function getSyncPayload(candidate = {}) {
  return {
    profile: candidate.profile || null,
    meals: normalizeSyncItems(getActiveMeals(candidate), (meal) => meal.id || `${meal.date}|${meal.time}|${meal.text}`),
    deletedMeals: normalizeSyncItems(candidate.deletedMeals, (meal) => meal.id),
    weights: normalizeSyncItems(candidate.weights, (weight) => weight.date),
    activities: normalizeSyncItems(candidate.activities, (activity) => activity.date),
  };
}

function normalizeSyncItems(items = [], keyFn) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ ...item }))
    .sort((a, b) => String(keyFn(a)).localeCompare(String(keyFn(b))));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function mergeActiveMeals(localState, remoteState) {
  const deleted = new Set(mergeDeletedMeals(localState.deletedMeals, remoteState.deletedMeals).map((meal) => meal.id));
  return mergeByKey(localState.meals, remoteState.meals, (meal) => meal.id || `${meal.date}|${meal.time}|${meal.text}`)
    .filter((meal) => meal.id ? !deleted.has(meal.id) : true);
}

function mergeDeletedMeals(localItems = [], remoteItems = []) {
  return mergeByKey(localItems, remoteItems, (meal) => meal.id, pickNewerDeletedMeal)
    .filter((meal) => meal.id);
}

function pickNewerDeletedMeal(a, b) {
  const aTime = Date.parse(a.updatedAt || a.deletedAt || a.date || 0) || 0;
  const bTime = Date.parse(b.updatedAt || b.deletedAt || b.date || 0) || 0;
  return bTime >= aTime ? b : a;
}

function mergeByKey(localItems = [], remoteItems = [], keyFn, resolver = pickNewerByUpdatedAt) {
  const map = new Map();
  [...localItems, ...remoteItems].forEach((item) => {
    const key = keyFn(item);
    const current = map.get(key);
    map.set(key, current ? resolver(current, item) : item);
  });
  return Array.from(map.values()).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function pickNewerByUpdatedAt(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aTime = Date.parse(a.updatedAt || a.date || 0) || 0;
  const bTime = Date.parse(b.updatedAt || b.date || 0) || 0;
  return bTime >= aTime ? b : a;
}

function resetData() {
  const confirmed = window.confirm("确认清空所有本地餐食、体重、档案和 API 设置吗？");
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(defaultState);
  calendarCursor = startOfMonth(parseDateKey(state.selectedDate));
  hydrateForms();
  render();
  $("#profileDialog").showModal();
}

function parseJsonFromText(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("AI 没有返回可解析的 JSON");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function formatSignedKcal(value, positiveLabel, negativeLabel) {
  const rounded = round(Math.abs(value));
  if (Math.abs(value) < 1) return `0 kcal`;
  return value >= 0 ? `${positiveLabel} ${rounded} kcal` : `${negativeLabel} ${rounded} kcal`;
}

function formatCalendarCalorieDelta(value) {
  if (Math.abs(value) < 1) return "0 kcal";
  return `${value > 0 ? "+" : "-"}${round(Math.abs(value))} kcal`;
}

function toDateKey(date) {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getCalendarDates(date) {
  const first = startOfMonth(date);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatMonthDay(dateKey) {
  const date = parseDateKey(dateKey);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatChineseDate(dateKey) {
  const date = parseDateKey(dateKey);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isCompactViewport() {
  return window.matchMedia?.("(max-width: 820px)").matches ?? window.innerWidth <= 820;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && value !== "" ? number : null;
}

function normalizeCloudPath(value) {
  const trimmed = String(value || "").trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function estimateActivityCalories({ steps = 0, minutes = 0, intensity = "中" } = {}) {
  const latestWeight = getLatestWeight()?.weight || state.profile?.weight || 70;
  const stepCalories = Number(steps) * latestWeight * 0.00045;
  const metByIntensity = { 低: 3.2, 中: 5.5, 高: 8 };
  const met = metByIntensity[intensity] || metByIntensity["中"];
  const exerciseCalories = met * latestWeight * (Number(minutes) || 0) / 60;
  return round(stepCalories + exerciseCalories);
}

function formatActivitySummary(activity) {
  const parts = [
    activity.steps ? `${round(activity.steps)} 步` : null,
    activity.type ? activity.type : null,
    activity.minutes ? `${round(activity.minutes)} 分钟` : null,
    activity.intensity ? `${activity.intensity}强度` : null,
    activity.calories ? `${round(activity.calories)} kcal` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "已记录";
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

