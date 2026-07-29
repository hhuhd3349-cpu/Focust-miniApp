(() => {
  "use strict";

  /* ---------------------------------------------------------
     Config
  --------------------------------------------------------- */
  const CIRCUMFERENCE = 2 * Math.PI * 118; // matches r=118 on the dial
  const STORAGE_KEY = "frb_state_v1";

  const MODE_META = {
    focus: { label: "Focus session", color: "--focus", soft: "--focus-soft", chip: "F" },
    short: { label: "Short break",   color: "--short", soft: "--short-soft", chip: "s" },
    long:  { label: "Long break",    color: "--long",  soft: "--long-soft",  chip: "L" }
  };

  const ROUTINES = {
    deepwork: { title: "Deep Work Block",   sequence: ["focus","short","focus","short","focus","short","focus","long"] },
    morning:  { title: "Morning Launch",    sequence: ["focus","short","focus","short","focus","long"] },
    study:    { title: "Study Sprint",      sequence: ["focus","short","focus","short","focus","long","focus","short","focus","short","focus","long"] },
    evening:  { title: "Evening Wind-down", sequence: ["focus","short","focus","long"] }
  };

  /* ---------------------------------------------------------
     Elements
  --------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  const timeDisplay   = $("timeDisplay");
  const dialLabel     = $("dialLabel");
  const dialProgress  = $("dialProgress");
  const ticksGroup    = $("ticks");
  const startBtn      = $("startBtn");
  const resetBtn      = $("resetBtn");
  const skipBtn       = $("skipBtn");
  const modeButtons   = document.querySelectorAll(".mode-btn");
  const tallyEl       = $("tally");
  const focusMinInput = $("focusMin");
  const shortMinInput = $("shortMin");
  const longMinInput  = $("longMin");
  const queuePanel    = $("queuePanel");
  const queueTitle    = $("queueTitle");
  const queueSteps    = $("queueSteps");
  const leaveRoutineBtn = $("leaveRoutineBtn");
  const routineCards   = document.querySelectorAll(".routine-card");

  const root = document.documentElement;

  /* ---------------------------------------------------------
     State
  --------------------------------------------------------- */
  let state = {
    mode: "focus",
    remaining: 25 * 60,
    running: false,
    completedFocusToday: 0,
    lastDate: todayKey(),
    durations: { focus: 25, short: 5, long: 15 },
    queue: null,        // { id, title, sequence: [...], index }
  };

  let tickHandle = null;

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  /* ---------------------------------------------------------
     Persistence
  --------------------------------------------------------- */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      state.durations = saved.durations || state.durations;
      state.lastDate = saved.lastDate || state.lastDate;
      state.completedFocusToday = saved.lastDate === todayKey() ? (saved.completedFocusToday || 0) : 0;
    } catch (e) { /* ignore corrupt storage */ }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        durations: state.durations,
        completedFocusToday: state.completedFocusToday,
        lastDate: todayKey()
      }));
    } catch (e) { /* storage may be unavailable — fail silently */ }
  }

  /* ---------------------------------------------------------
     Dial ticks (60 marks, thicker every 5th — signature detail)
  --------------------------------------------------------- */
  function buildTicks() {
    const frag = document.createDocumentFragment();
    const cx = 150, cy = 150, rOuter = 132, rInnerMinor = 124, rInnerMajor = 119;
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2;
      const major = i % 5 === 0;
      const rInner = major ? rInnerMajor : rInnerMinor;
      const x1 = cx + rOuter * Math.cos(angle);
      const y1 = cy + rOuter * Math.sin(angle);
      const x2 = cx + rInner * Math.cos(angle);
      const y2 = cy + rInner * Math.sin(angle);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1.toFixed(2));
      line.setAttribute("y1", y1.toFixed(2));
      line.setAttribute("x2", x2.toFixed(2));
      line.setAttribute("y2", y2.toFixed(2));
      if (major) line.classList.add("tick-major");
      frag.appendChild(line);
    }
    ticksGroup.appendChild(frag);
  }

  /* ---------------------------------------------------------
     Rendering
  --------------------------------------------------------- */
  function totalForMode(mode) {
    return state.durations[mode] * 60;
  }

  function render() {
    const total = totalForMode(state.mode);
    const mins = Math.floor(state.remaining / 60).toString().padStart(2, "0");
    const secs = Math.floor(state.remaining % 60).toString().padStart(2, "0");
    timeDisplay.textContent = `${mins}:${secs}`;
    dialLabel.textContent = MODE_META[state.mode].label;

    const fraction = total > 0 ? state.remaining / total : 0;
    dialProgress.style.strokeDashoffset = (CIRCUMFERENCE * (1 - fraction)).toFixed(2);

    const meta = MODE_META[state.mode];
    root.style.setProperty("--accent", `var(${meta.color})`);
    root.style.setProperty("--accent-soft", `var(${meta.soft})`);

    modeButtons.forEach(btn => {
      const active = btn.dataset.mode === state.mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    startBtn.textContent = state.running ? "Pause" : "Start";

    renderTally();
    renderQueue();

    document.title = state.running
      ? `${mins}:${secs} · ${meta.label} — Focus & Routine Buddy`
      : "Focus & Routine Buddy";
  }

  function renderTally() {
    tallyEl.innerHTML = "";
    const shown = Math.max(state.completedFocusToday, 8);
    for (let i = 0; i < shown; i++) {
      const dot = document.createElement("span");
      dot.className = "tally-dot" + (i < state.completedFocusToday ? " is-filled" : "");
      tallyEl.appendChild(dot);
    }
  }

  function renderQueue() {
    if (!state.queue) {
      queuePanel.hidden = true;
      return;
    }
    queuePanel.hidden = false;
    queueTitle.textContent = state.queue.title;
    queueSteps.innerHTML = "";
    state.queue.sequence.forEach((m, i) => {
      const step = document.createElement("div");
      const meta = MODE_META[m];
      step.className = `queue-step step-${m}` +
        (i < state.queue.index ? " is-done" : "") +
        (i === state.queue.index ? " is-current" : "");
      step.textContent = meta.chip;
      step.title = meta.label;
      queueSteps.appendChild(step);
    });
  }

  /* ---------------------------------------------------------
     Timer engine
  --------------------------------------------------------- */
  function start() {
    if (state.running) { pause(); return; }
    state.running = true;
    tickHandle = setInterval(tick, 1000);
    render();
  }

  function pause() {
    state.running = false;
    clearInterval(tickHandle);
    render();
  }

  function tick() {
    state.remaining -= 1;
    if (state.remaining <= 0) {
      completeSession();
      return;
    }
    render();
  }

  function reset() {
    pause();
    state.remaining = totalForMode(state.mode);
    render();
  }

  function skip() {
    completeSession(true);
  }

  function setMode(mode, { keepQueue } = {}) {
    state.mode = mode;
    state.remaining = totalForMode(mode);
    if (!keepQueue) state.queue = null;
    render();
  }

  function completeSession(silent) {
    pause();
    const finishedMode = state.mode;

    if (!silent) {
      playChime();
      if (finishedMode === "focus") {
        state.completedFocusToday += 1;
        saveState();
      }
    }

    if (state.queue) {
      state.queue.index += 1;
      if (state.queue.index >= state.queue.sequence.length) {
        state.queue = null;
        setMode("focus");
        return;
      }
      const nextMode = state.queue.sequence[state.queue.index];
      setMode(nextMode, { keepQueue: true });
      return;
    }

    // Freestanding pomodoro: focus -> short, break -> focus
    const nextMode = finishedMode === "focus" ? "short" : "focus";
    setMode(nextMode);
  }

  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      [660, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.18 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.18);
        osc.stop(now + i * 0.18 + 0.4);
      });
      setTimeout(() => ctx.close(), 900);
    } catch (e) { /* audio unavailable — fail silently */ }
  }

  /* ---------------------------------------------------------
     Routines
  --------------------------------------------------------- */
  function loadRoutine(id) {
    const def = ROUTINES[id];
    if (!def) return;
    pause();
    state.queue = { id, title: def.title, sequence: def.sequence, index: 0 };
    setMode(def.sequence[0], { keepQueue: true });

    routineCards.forEach(c => c.classList.toggle("is-loaded", c.dataset.routine === id));
    document.getElementById("start").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function leaveRoutine() {
    state.queue = null;
    routineCards.forEach(c => c.classList.remove("is-loaded"));
    setMode("focus");
  }

  /* ---------------------------------------------------------
     Custom durations
  --------------------------------------------------------- */
  function applyDurationInputs() {
    const f = clamp(parseInt(focusMinInput.value, 10) || 25, 1, 90);
    const s = clamp(parseInt(shortMinInput.value, 10) || 5, 1, 30);
    const l = clamp(parseInt(longMinInput.value, 10) || 15, 1, 60);
    state.durations = { focus: f, short: s, long: l };
    saveState();
    if (!state.running) {
      state.remaining = totalForMode(state.mode);
    }
    render();
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /* ---------------------------------------------------------
     Wire up events
  --------------------------------------------------------- */
  function init() {
    loadState();
    buildTicks();

    focusMinInput.value = state.durations.focus;
    shortMinInput.value = state.durations.short;
    longMinInput.value = state.durations.long;
    state.remaining = totalForMode(state.mode);

    startBtn.addEventListener("click", start);
    resetBtn.addEventListener("click", reset);
    skipBtn.addEventListener("click", skip);

    modeButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        state.queue = null;
        routineCards.forEach(c => c.classList.remove("is-loaded"));
        pause();
        setMode(btn.dataset.mode);
      });
    });

    [focusMinInput, shortMinInput, longMinInput].forEach(input => {
      input.addEventListener("change", applyDurationInputs);
    });

    routineCards.forEach(card => {
      card.querySelector(".routine-btn").addEventListener("click", () => {
        loadRoutine(card.dataset.routine);
      });
    });

    leaveRoutineBtn.addEventListener("click", leaveRoutine);

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
