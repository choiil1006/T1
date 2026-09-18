// Screen management + the setup screen: music upload, saved-song library,
// BPM tap/auto-detect, difficulty, sync-offset calibration, and wiring the
// result/pause screens' buttons back into the game.
(function () {
  "use strict";

  const state = SF.state;

  function showScreen(name) {
    Object.values(SF.screens).forEach((s) => s.classList.remove("active"));
    SF.screens[name].classList.add("active");
  }

  // the current song's name is shown in two places — the compact summary on
  // the main screen, and the upload label inside the settings screen — so
  // they're kept in sync from one place
  function setCurrentSongDisplay(name) {
    SF.$("fnameText").textContent = name || "아직 곡을 불러오지 않았어요 — 설정에서 불러오세요";
    SF.$("fnameTextSettings").textContent = name || "MP3 / WAV 파일 선택…";
  }

  // in-page toast — window.alert()/confirm() are silently suppressed inside
  // some embedded browsers/webviews (they just return false instantly with
  // no dialog ever shown), so every user-facing message goes through here
  // instead of alert(), and destructive actions use a two-step button
  // (see wireDangerButton) instead of confirm().
  function showToast(message, { type = "info", duration = 2600 } = {}) {
    const stack = SF.$("toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " error" : "");
    el.textContent = message;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 200);
    }, duration);
  }

  // arms a button so the first click asks for confirmation in-place (label
  // + danger styling) and only the follow-up click within `armMs` runs
  // `onConfirm` — a self-contained replacement for confirm() dialogs.
  function wireDangerButton(btn, confirmLabel, onConfirm, armMs = 3000) {
    const idleLabel = btn.textContent;
    let armed = false, timer = null;
    btn.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        btn.textContent = confirmLabel;
        btn.classList.add("danger");
        timer = setTimeout(() => { armed = false; btn.textContent = idleLabel; btn.classList.remove("danger"); }, armMs);
        return;
      }
      clearTimeout(timer);
      armed = false;
      btn.textContent = idleLabel;
      btn.classList.remove("danger");
      onConfirm();
    });
  }

  function updateChartStatus() {
    SF.$("chartStatus").textContent = (state.useCustomChart && state.customChart && state.customChart.length)
      ? `현재: 직접 만든 패턴 사용 중 (${state.customChart.length}개 노트)`
      : "현재: 자동 생성 패턴 사용 중";
  }

  function formatScore(entry) {
    if (!entry) return null;
    return `BEST ${entry.grade} · ${entry.score}점 · ${entry.accuracy.toFixed(1)}%`;
  }

  function applyLoadedSong(id, name, blob, meta) {
    if (state.audioURL) URL.revokeObjectURL(state.audioURL);
    state.currentSongId = id;
    state.audioFile = blob;
    state.audioURL = URL.createObjectURL(blob);
    state.onset = null; // a different song invalidates any cached onset envelope
    setCurrentSongDisplay(name);
    SF.$("startBtn").disabled = false;
    SF.$("startBtn").textContent = "게임 시작";
    SF.$("openEditorBtn").disabled = false;

    state.phaseOffsetMs = (meta && meta.phaseOffsetMs) || 0;
    SF.$("bpmInput").value = (meta && meta.bpm) || 120;
    state.customChart = (meta && meta.customChart) || null;
    state.useCustomChart = !!(meta && meta.useCustomChart && state.customChart && state.customChart.length);
    SF.editor.loadFromCustomChart(state.customChart);
    updateChartStatus();

    state.songAnalyzed = !!(meta && meta.analyzed);
    if (!state.songAnalyzed) {
      runAutoAnalysis(); // never analyzed before — do it now instead of making the user press a button
    } else {
      SF.$("tapHint").textContent = `저장된 BPM ${SF.$("bpmInput").value}을 사용합니다. 다르게 느껴지면 숫자를 직접 수정하세요.`;
    }
  }

  async function selectSong(id) {
    try {
      const rec = await SF.storage.idbGet("song:" + id);
      if (!rec || !rec.blob) { showToast("저장된 음원을 찾을 수 없습니다.", { type: "error" }); return; }
      const meta = await SF.storage.getSongMeta(id);
      applyLoadedSong(id, rec.name, rec.blob, meta);
      await SF.storage.idbSet("lastSelectedId", id);
      renderSongList();
    } catch (err) { console.warn("select song failed", err); }
  }

  async function renameSong(id, newName) {
    newName = (newName || "").trim();
    if (!newName) return;
    try {
      const rec = await SF.storage.idbGet("song:" + id);
      if (rec) { rec.name = newName; await SF.storage.idbSet("song:" + id, rec); }
      const index = await SF.storage.getSongIndex();
      const entry = index.find((s) => s.id === id);
      if (entry) entry.name = newName;
      await SF.storage.setSongIndex(index);
      if (state.currentSongId === id) setCurrentSongDisplay(newName);
      renderSongList();
    } catch (err) { console.warn("rename failed", err); }
  }

  async function deleteSong(id) {
    try {
      await SF.storage.deleteSongRecord(id);
      const index = (await SF.storage.getSongIndex()).filter((s) => s.id !== id);
      await SF.storage.setSongIndex(index);
      if (state.currentSongId === id) {
        if (state.audioURL) URL.revokeObjectURL(state.audioURL);
        state.currentSongId = null; state.audioURL = null; state.audioFile = null;
        setCurrentSongDisplay(null);
        SF.$("startBtn").disabled = true; SF.$("startBtn").textContent = "음악을 먼저 불러오세요";
        SF.$("openEditorBtn").disabled = true;
      }
      showToast("곡을 삭제했습니다.");
      renderSongList();
    } catch (err) {
      console.warn("delete failed", err);
      showToast("삭제에 실패했습니다.", { type: "error" });
    }
  }

  // main screen: just a clickable name — click it to select that song
  async function buildCompactSongRow(entry) {
    const row = document.createElement("div");
    row.className = "songRow songRow-compact" + (entry.id === state.currentSongId ? " active" : "");
    row.tabIndex = 0;
    row.addEventListener("click", () => selectSong(entry.id));
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSong(entry.id); } });

    const nameWrap = document.createElement("div");
    nameWrap.className = "songName";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = entry.name;
    nameWrap.appendChild(nameSpan);
    let scores = {};
    try { scores = await SF.storage.getHighScores(entry.id); } catch (err) { /* ignore */ }
    const bestAny = scores.hard || scores.normal || scores.easy;
    if (bestAny) {
      const best = document.createElement("div");
      best.className = "best";
      best.textContent = formatScore(bestAny);
      nameWrap.appendChild(best);
    }
    row.appendChild(nameWrap);

    if (entry.id === state.currentSongId) {
      const tag = document.createElement("span");
      tag.className = "songSelectedTag";
      tag.textContent = "선택됨";
      row.appendChild(tag);
    }
    return row;
  }

  // settings screen: name plus rename/delete only — no selecting from here
  function buildManageSongRow(entry) {
    const row = document.createElement("div");
    row.className = "songRow" + (entry.id === state.currentSongId ? " active" : "");

    const nameWrap = document.createElement("div");
    nameWrap.className = "songName";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = entry.name;
    nameWrap.appendChild(nameSpan);
    row.appendChild(nameWrap);

    const renameBtn = document.createElement("button");
    renameBtn.className = "btn small";
    renameBtn.textContent = "이름변경";
    renameBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.className = "renameInput";
      input.value = entry.name;
      nameWrap.replaceWith(input);
      input.focus(); input.select();
      const commit = () => renameSong(entry.id, input.value);
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") commit(); if (ev.key === "Escape") renderSongList(); });
      input.addEventListener("blur", commit);
    });
    row.appendChild(renameBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "btn small";
    delBtn.textContent = "삭제";
    wireDangerButton(delBtn, "정말 삭제?", () => deleteSong(entry.id));
    row.appendChild(delBtn);

    return row;
  }

  async function renderSongList() {
    let index;
    try { index = await SF.storage.getSongIndex(); } catch (err) { index = []; }
    const card = SF.$("songListCard"), container = SF.$("songListContainer");
    const manageCard = SF.$("songManageCard"), manageContainer = SF.$("songManageContainer");
    if (!index.length) {
      card.style.display = "none"; container.innerHTML = "";
      manageCard.style.display = "none"; manageContainer.innerHTML = "";
      return;
    }
    card.style.display = "block";
    manageCard.style.display = "block";
    index.sort((a, b) => b.addedAt - a.addedAt);

    container.innerHTML = "";
    for (const entry of index) container.appendChild(await buildCompactSongRow(entry));

    manageContainer.innerHTML = "";
    index.forEach((entry) => manageContainer.appendChild(buildManageSongRow(entry)));
  }

  function initMusicUpload() {
    SF.$("audioFile").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      SF.sfx.unlock();
      if (state.audioURL) URL.revokeObjectURL(state.audioURL);
      state.audioURL = URL.createObjectURL(f);
      state.audioFile = f;
      state.phaseOffsetMs = 0;
      state.onset = null;
      state.songAnalyzed = false;
      setCurrentSongDisplay(f.name);
      SF.$("startBtn").disabled = false;
      SF.$("startBtn").textContent = "게임 시작";
      SF.$("openEditorBtn").disabled = false;
      // a freshly uploaded song starts with no custom chart of its own
      state.useCustomChart = false;
      state.customChart = null;
      SF.editor.loadFromCustomChart(null);
      updateChartStatus();
      const id = await SF.storage.addSongToLibrary(f);
      state.currentSongId = id;
      await SF.storage.persistSongMeta();
      renderSongList();
      runAutoAnalysis(); // new song, never analyzed — measure its BPM automatically
    });
  }

  // runs the moment a song becomes current and hasn't been analyzed before —
  // there are no TAP/analyze buttons to press, this just happens on its own
  async function runAutoAnalysis() {
    if (!state.audioFile) return;
    SF.$("tapHint").textContent = "곡을 분석해서 BPM을 자동으로 측정하는 중입니다…";
    try {
      const { bpm, phaseMs, onset } = await SF.audioAnalysis.analyzeBPM(state.audioFile);
      SF.$("bpmInput").value = bpm;
      state.phaseOffsetMs = phaseMs;
      state.onset = onset;
      state.songAnalyzed = true;
      SF.$("tapHint").textContent = `자동 측정 완료: BPM ${bpm} (첫 박 위치 보정, 채보에도 비트 강도가 반영됩니다). 다르게 느껴지면 숫자를 직접 수정하세요.`;
      SF.storage.persistSongMeta();
    } catch (err) {
      SF.$("tapHint").textContent = "자동 분석에 실패했습니다. 숫자를 직접 입력해 BPM을 맞춰주세요.";
    }
  }

  function initTempoControls() {
    SF.$("bpmInput").addEventListener("change", () => {
      state.songAnalyzed = true; // a manual correction counts as "settled" — don't overwrite it later
      SF.storage.persistSongMeta();
    });
  }

  function initDifficulty() {
    SF.$("diffGrid").addEventListener("click", (e) => {
      const el = e.target.closest(".diffBtn");
      if (!el) return;
      document.querySelectorAll(".diffBtn").forEach((b) => b.classList.remove("sel"));
      el.classList.add("sel");
      state.difficulty = el.dataset.diff;
      SF.storage.persistGlobalSettings();
    });
  }

  function initSyncOffset() {
    const input = SF.$("offsetInput");
    const applyDelta = (delta) => {
      state.syncOffsetMs = Math.max(-300, Math.min(300, state.syncOffsetMs + delta));
      input.value = state.syncOffsetMs;
      SF.storage.persistGlobalSettings();
    };
    SF.$("offsetMinus").addEventListener("click", () => applyDelta(-10));
    SF.$("offsetPlus").addEventListener("click", () => applyDelta(10));
    input.addEventListener("change", () => {
      const v = parseInt(input.value, 10);
      state.syncOffsetMs = isFinite(v) ? Math.max(-300, Math.min(300, v)) : 0;
      input.value = state.syncOffsetMs;
      SF.storage.persistGlobalSettings();
    });
  }

  function initStartAndResultButtons() {
    SF.$("startBtn").addEventListener("click", () => { SF.sfx.unlock(); SF.game.startGame(); });
    SF.$("resumeBtn").addEventListener("click", SF.game.togglePause);
    SF.$("quitBtn").addEventListener("click", SF.game.quit);
    SF.$("retryBtn").addEventListener("click", SF.game.startGame);
    SF.$("backBtn").addEventListener("click", () => showScreen("setup"));
  }

  async function restoreFromStorage() {
    await SF.storage.migrateLegacySingleSong();

    try {
      const settings = await SF.storage.loadGlobalSettings();
      if (settings) {
        if (settings.difficulty) {
          state.difficulty = settings.difficulty;
          document.querySelectorAll(".diffBtn").forEach((b) => b.classList.toggle("sel", b.dataset.diff === settings.difficulty));
        }
        if (settings.mapping) {
          state.mapping = settings.mapping;
          SF.LANES.forEach(SF.input.renderPadSlot);
        }
        if (typeof settings.syncOffsetMs === "number") {
          state.syncOffsetMs = settings.syncOffsetMs;
          SF.$("offsetInput").value = state.syncOffsetMs;
        }
      }
    } catch (err) { /* ignore */ }

    await renderSongList();

    try {
      const index = await SF.storage.getSongIndex();
      if (index.length) {
        let lastId = null;
        try { lastId = await SF.storage.idbGet("lastSelectedId"); } catch (e) { /* ignore */ }
        const target = index.find((s) => s.id === lastId) || index.slice().sort((a, b) => b.addedAt - a.addedAt)[0];
        if (target) await selectSong(target.id);
      }
    } catch (err) { /* ignore */ }
  }

  function initSettingsScreen() {
    SF.$("openSettingsBtn").addEventListener("click", () => showScreen("settings"));
    SF.$("settingsBackBtn").addEventListener("click", () => showScreen("setup"));
  }

  function init() {
    SF.screens.setup = SF.$("setupScreen");
    SF.screens.settings = SF.$("settingsScreen");
    SF.screens.game = SF.$("gameScreen");
    SF.screens.result = SF.$("resultScreen");
    SF.screens.editor = SF.$("editorScreen");

    initMusicUpload();
    initTempoControls();
    initDifficulty();
    initSyncOffset();
    initSettingsScreen();
    initStartAndResultButtons();
  }

  SF.ui = { init, showScreen, updateChartStatus, renderSongList, selectSong, restoreFromStorage, showToast, wireDangerButton };
})();
