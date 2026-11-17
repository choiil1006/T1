// Screen management + the song select screen (library list, search, random,
// selected-song panel, difficulty, start), menu navigation from the pad or
// keyboard, the settings screen's upload/sync controls, and wiring the
// result/pause screens' buttons back into the game.
(function () {
  "use strict";

  const state = SF.state;
  const DIFFS = ["easy", "normal", "hard"];
  let resultReadyAt = 0; // pad input on the result screen is ignored until this time

  function showScreen(name) {
    const prev = document.body.dataset.screen;
    Object.values(SF.screens).forEach((s) => s.classList.remove("active", "enter"));
    const el = SF.screens[name];
    el.classList.add("active");
    if (prev !== name) { void el.offsetWidth; el.classList.add("enter"); }
    document.body.dataset.screen = name; // lets CSS show things on one screen only (see #bgLogo)
    if (prev !== name && SF.loadcell) SF.loadcell.screenChanged(name); // live load cell view on settings only
    if (name === "setup") {
      renderBestPopup(false); // a game may just have set a new record
      scrollActiveSongIntoView(false);
      schedulePreview(prev === name ? 350 : 150);
    } else {
      clearTimeout(previewTimer);
      SF.preview.stop();
    }
    if (name === "result") resultReadyAt = performance.now() + 900;
  }

  // ---- highlight preview of the selected song (song select screen only) ----
  let previewTimer = null;
  let analysisRunningFor = null; // song id whose BPM/highlight analysis is in flight
  let highlightJob = null;       // {id, promise} — highlight-only analysis for older songs

  // waits a moment so flicking through the list with the pad doesn't start
  // (and decode) every song passed on the way
  function schedulePreview(delay = 350) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(startPreviewForCurrent, delay);
  }

  // songs analyzed before highlights existed: find it once and save it
  function ensureHighlight(id, blob) {
    if (highlightJob && highlightJob.id === id) return highlightJob.promise;
    const bpm = parseInt(SF.$("bpmInput").value, 10) || 120;
    const promise = SF.audioAnalysis.analyzeHighlight(blob, bpm, state.phaseOffsetMs)
      .then((sec) => {
        SF.storage.updateSongMeta(id, { previewStart: sec });
        if (state.currentSongId === id) state.previewStartSec = sec;
        return sec;
      })
      .catch(() => null)
      .finally(() => { if (highlightJob && highlightJob.id === id) highlightJob = null; });
    highlightJob = { id, promise };
    return promise;
  }

  async function startPreviewForCurrent() {
    const id = state.currentSongId, blob = state.audioFile;
    if (!id || !blob || document.body.dataset.screen !== "setup") return;
    let start = state.previewStartSec;
    if (start == null) {
      if (analysisRunningFor === id) return; // runAutoAnalysis starts the preview when it's done
      start = await ensureHighlight(id, blob);
      if (state.currentSongId !== id || document.body.dataset.screen !== "setup") return;
    }
    SF.preview.play(id, blob, start); // start null -> preview falls back to ~30% in
  }

  // the current song's name is shown on the song select panel, in game, on
  // the result screen and in the settings upload label — kept in one place
  function setCurrentSongDisplay(name) {
    state.currentSongName = name || "";
    const title = SF.$("fnameText");
    title.textContent = name || "곡을 선택하세요";
    title.classList.toggle("empty", !name);
    SF.$("fnameTextSettings").textContent = name || "MP3 / WAV 파일 선택…";
  }

  function setStartEnabled(enabled) {
    const btn = SF.$("startBtn");
    btn.disabled = !enabled;
    btn.querySelector(".startMain").textContent = enabled ? "START" : "곡을 선택하세요";
    SF.$("openEditorBtn").disabled = !enabled;
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

  // the selected song's best record on each difficulty, with the currently
  // chosen difficulty highlighted. `pop` replays the pop-in animation.
  async function renderBestPopup(pop) {
    const box = SF.$("bestPopup");
    if (!state.currentSongId) { box.style.display = "none"; return; }
    let scores = {};
    try { scores = await SF.storage.getHighScores(state.currentSongId); } catch (err) { /* ignore */ }
    if (!state.currentSongId) { box.style.display = "none"; return; }

    box.textContent = "";
    const title = document.createElement("div");
    title.className = "bpTitle";
    title.textContent = "BEST RECORD";
    box.appendChild(title);
    DIFFS.forEach((d) => {
      const row = document.createElement("div");
      row.className = "bpRow" + (d === state.difficulty ? " active" : "");
      const label = document.createElement("span");
      label.className = "bpDiff";
      label.textContent = SF.DIFF[d].label;
      const value = document.createElement("span");
      const rec = scores[d];
      value.textContent = rec
        ? `${rec.grade} · ${rec.score.toLocaleString()} · ${rec.accuracy.toFixed(1)}%`
        : "기록 없음";
      if (!rec) value.className = "bpNone";
      row.append(label, value);
      box.appendChild(row);
    });
    box.style.display = "block";
    if (pop) {
      box.classList.remove("pop");
      void box.offsetWidth;
      box.classList.add("pop");
    }
  }

  function applyLoadedSong(id, name, blob, meta) {
    if (state.audioURL) URL.revokeObjectURL(state.audioURL);
    if (state.currentSongId !== id) SF.preview.stop();
    state.currentSongId = id;
    state.previewStartSec = meta && typeof meta.previewStart === "number" ? meta.previewStart : null;
    state.audioFile = blob;
    state.audioURL = URL.createObjectURL(blob);
    setCurrentSongDisplay(name);
    setStartEnabled(true);

    state.phaseOffsetMs = (meta && meta.phaseOffsetMs) || 0;
    SF.$("bpmInput").value = (meta && meta.bpm) || 120;
    state.customChart = (meta && meta.customChart) || null;
    state.useCustomChart = !!(meta && meta.useCustomChart && state.customChart && state.customChart.length);
    SF.editor.loadFromCustomChart(state.customChart);

    state.songAnalyzed = !!(meta && meta.analyzed);
    if (!state.songAnalyzed) {
      runAutoAnalysis(); // never analyzed before — do it now instead of making the user press a button
    } else {
      SF.$("tapHint").textContent = "저장된 BPM";
    }
    renderBestPopup(true);
    schedulePreview();
  }

  async function selectSong(id) {
    try {
      const rec = await SF.storage.idbGet("song:" + id);
      if (!rec || !rec.blob) { showToast("저장된 음원을 찾을 수 없습니다.", { type: "error" }); return; }
      const meta = await SF.storage.getSongMeta(id);
      applyLoadedSong(id, rec.name, rec.blob, meta);
      await SF.storage.idbSet("lastSelectedId", id);
      await renderSongList();
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
        SF.preview.stop();
        if (state.audioURL) URL.revokeObjectURL(state.audioURL);
        state.currentSongId = null; state.audioURL = null; state.audioFile = null;
        setCurrentSongDisplay(null);
        setStartEnabled(false);
        SF.$("tapHint").textContent = "";
      }
      showToast("곡을 삭제했습니다.");
      renderSongList();
    } catch (err) {
      console.warn("delete failed", err);
      showToast("삭제에 실패했습니다.", { type: "error" });
    }
  }

  // song select: number + name, click (or pad) to select
  function buildCompactSongRow(entry, i) {
    const row = document.createElement("div");
    row.className = "songRow songRow-compact" + (entry.id === state.currentSongId ? " active" : "");
    row.dataset.id = entry.id;
    row.tabIndex = 0;
    row.addEventListener("click", () => { SF.sfx.unlock(); SF.sfx.playMenu("move"); selectSong(entry.id); });
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSong(entry.id); } });

    const no = document.createElement("span");
    no.className = "songNo";
    no.textContent = String(i + 1).padStart(2, "0");
    row.appendChild(no);

    const nameWrap = document.createElement("div");
    nameWrap.className = "songName";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = entry.name;
    nameWrap.appendChild(nameSpan);
    row.appendChild(nameWrap);
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

  // ---- ordering and searching the song list ----

  // Hangul first (가나다), then other letters (abc), then anything that
  // starts with a digit/symbol. Leading punctuation like "(" or "[" is
  // skipped so it doesn't decide the order, text is normalized to NFC (file
  // names from macOS can arrive as decomposed Hangul), Latin compares
  // case-insensitively and digit runs compare as numbers ("2" before "10").
  const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  function sortKey(name) {
    return name.normalize("NFC").replace(/^[^\p{L}\p{N}]+/u, "");
  }
  function nameGroup(key) {
    const first = key.charAt(0);
    if (/\p{Script=Hangul}/u.test(first)) return 0;
    if (/\p{L}/u.test(first)) return 1;
    return 2;
  }
  function compareSongs(a, b) {
    const ka = sortKey(a.name), kb = sortKey(b.name);
    const ga = nameGroup(ka), gb = nameGroup(kb);
    if (ga !== gb) return ga - gb;
    return nameCollator.compare(ka, kb) || a.addedAt - b.addedAt;
  }

  // lower-cased, with the "_" "-" "." "(" ")" that file names are full of
  // treated as spaces, so typing "pop off" finds "kiiikiii_-_pop_off_pop_off…"
  function normalizeForSearch(text) {
    return text.normalize("NFC").toLowerCase().replace(/[_\-.()[\]{}]+/g, " ").replace(/\s+/g, " ").trim();
  }

  let songIndexCache = []; // last index renderSongList read, so searching doesn't hit storage per keystroke
  let songSearchQuery = "";

  function visibleSongs() {
    const sorted = songIndexCache.slice().sort(compareSongs);
    const q = normalizeForSearch(songSearchQuery);
    return q ? sorted.filter((s) => normalizeForSearch(s.name).includes(q)) : sorted;
  }

  function scrollActiveSongIntoView(smooth) {
    const row = document.querySelector("#songListContainer .songRow-compact.active");
    if (row) row.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
  }

  function renderCompactList() {
    const container = SF.$("songListContainer");
    container.innerHTML = "";
    SF.$("songCount").textContent = songIndexCache.length ? `${songIndexCache.length} SONGS` : "";
    if (!songIndexCache.length) {
      const empty = document.createElement("div");
      empty.className = "songEmpty";
      empty.textContent = "아직 저장된 곡이 없어요.";
      const btn = document.createElement("button");
      btn.className = "btn primary";
      btn.textContent = "음악 불러오기";
      btn.addEventListener("click", () => SF.$("audioFile").click());
      empty.appendChild(document.createElement("br"));
      empty.appendChild(btn);
      container.appendChild(empty);
      return;
    }
    const visible = visibleSongs();
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "songEmpty";
      empty.textContent = `"${songSearchQuery.trim()}"에 맞는 곡이 없어요.`;
      container.appendChild(empty);
      return;
    }
    visible.forEach((entry, i) => container.appendChild(buildCompactSongRow(entry, i)));
  }

  // picks among the songs currently listed (so with a search active it's a
  // random pick among the matches), never the one already selected unless
  // it's the only choice
  async function pickRandomSong() {
    const candidates = visibleSongs();
    if (!candidates.length) { showToast("고를 수 있는 곡이 없어요.", { type: "error" }); return; }
    let pool = candidates.filter((s) => s.id !== state.currentSongId);
    if (!pool.length) pool = candidates;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    SF.sfx.playMenu("select");
    await selectSong(pick.id);
    showToast("랜덤 선택: " + pick.name);
    scrollActiveSongIntoView(true);
  }

  function initSongTools() {
    SF.$("songSearch").addEventListener("input", (e) => {
      songSearchQuery = e.target.value;
      renderCompactList();
    });
    SF.$("randomSongBtn").addEventListener("click", () => { SF.sfx.unlock(); pickRandomSong(); });
  }

  async function renderSongList() {
    let index;
    try { index = await SF.storage.getSongIndex(); } catch (err) { index = []; }
    songIndexCache = index;
    const manageCard = SF.$("songManageCard"), manageContainer = SF.$("songManageContainer");

    renderCompactList();

    manageContainer.innerHTML = "";
    manageCard.style.display = index.length ? "block" : "none";
    index.slice().sort(compareSongs).forEach((entry) => manageContainer.appendChild(buildManageSongRow(entry)));
    renderBestPopup(false);
  }

  // ---- menu navigation (pad / keyboard) ----

  // id we're moving to, so quick repeated presses step from the latest
  // target instead of the song that's still loading
  let navTargetId = null;

  async function moveSong(delta) {
    const list = visibleSongs();
    if (!list.length) return;
    const fromId = navTargetId || state.currentSongId;
    let idx = list.findIndex((s) => s.id === fromId);
    idx = idx < 0 ? (delta > 0 ? 0 : list.length - 1) : (idx + delta + list.length) % list.length;
    const id = list[idx].id;
    navTargetId = id;
    SF.sfx.playMenu("move");
    await selectSong(id);
    if (navTargetId === id) navTargetId = null;
    scrollActiveSongIntoView(true);
  }

  function setDifficulty(d) {
    if (!DIFFS.includes(d)) return;
    state.difficulty = d;
    document.querySelectorAll(".diffBtn").forEach((b) => b.classList.toggle("sel", b.dataset.diff === d));
    SF.storage.persistGlobalSettings();
    renderBestPopup(false);
  }

  function stepDifficulty(delta) {
    const i = DIFFS.indexOf(state.difficulty);
    const next = Math.max(0, Math.min(DIFFS.length - 1, i + delta));
    if (next === i) return;
    SF.sfx.playMenu("diff");
    setDifficulty(DIFFS[next]);
  }

  function startSelected() {
    if (SF.$("startBtn").disabled) return;
    SF.sfx.unlock();
    SF.sfx.playMenu("select");
    SF.game.startGame();
  }

  function backToSelect() {
    SF.sfx.playMenu("back");
    showScreen("setup");
  }

  function retry() {
    SF.sfx.playMenu("select");
    SF.game.startGame();
  }

  // a pad press while no song is running: arcade-style menu controls
  //   song select:  ↙ previous song  ↘ next song  ↖ easier  ↗ harder  ⊙ start
  //   result:       ⊙ back to song select  ↗ play again
  function menuLane(lane) {
    SF.sfx.unlock();
    const screen = document.body.dataset.screen;
    if (screen === "setup") {
      if (lane === "DL") moveSong(-1);
      else if (lane === "DR") moveSong(1);
      else if (lane === "UL") stepDifficulty(-1);
      else if (lane === "UR") stepDifficulty(1);
      else if (lane === "CN") startSelected();
    } else if (screen === "result") {
      if (performance.now() < resultReadyAt) return;
      if (lane === "CN") backToSelect();
      else if (lane === "UR") retry();
    }
  }

  // arrow keys / Enter / Esc mirror the pad on menus (mapped lane keys are
  // already handled through menuLane, so they're skipped here)
  function initMenuKeys() {
    window.addEventListener("keydown", (e) => {
      if (state.running || state.listeningLane || SF.input.isTyping()) return;
      if (SF.input.laneForKeyCode(e.code)) return;
      const screen = document.body.dataset.screen;
      const onControl = document.activeElement && document.activeElement !== document.body;
      if (screen === "setup") {
        if (e.key === "ArrowUp") { e.preventDefault(); moveSong(-1); }
        else if (e.key === "ArrowDown") { e.preventDefault(); moveSong(1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); stepDifficulty(-1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); stepDifficulty(1); }
        else if (e.key === "Enter" && !onControl) { e.preventDefault(); startSelected(); }
      } else if (screen === "result") {
        if (performance.now() < resultReadyAt) return;
        if (e.key === "Enter" && !onControl) { e.preventDefault(); backToSelect(); }
      } else if (screen === "settings" && e.key === "Escape") {
        backToSelect();
      }
    });
  }

  const MIN_SONG_SEC = 20;

  function initMusicUpload() {
    SF.$("audioFile").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      // clear right away: picking the same file again (e.g. after a failed
      // attempt) must still fire "change"
      e.target.value = "";
      if (!f) return;
      SF.sfx.unlock();

      // the same song again (often re-picked after thinking it failed):
      // select the one already there instead of adding a duplicate
      const existing = songIndexCache.find((s) => s.name === f.name);
      if (existing) {
        await selectSong(existing.id);
        scrollActiveSongIntoView(true);
        showToast(`"${f.name}"은(는) 이미 목록에 있어서 그 곡을 선택했어요.`);
        return;
      }

      // decode + analyze BEFORE adding it, so a file the browser can't read
      // gets a clear reason instead of becoming a broken library entry
      showToast(`"${f.name}" 불러오는 중…`, { duration: 1800 });
      let analysis;
      try {
        analysis = await SF.audioAnalysis.analyzeBPM(f);
      } catch (err) {
        const why = await SF.audioAnalysis.describeUnreadable(f);
        console.warn("upload: cannot decode", f.name, f.type, f.size, why, err);
        showToast(`"${f.name}"을(를) 읽을 수 없습니다 — ${why}`, { type: "error", duration: 7000 });
        return;
      }
      // a few seconds of audio (a broken download, a ringtone clip) can't
      // carry a chart: notes need a 4-beat lead-in and the last 3 s stay empty
      if (analysis.durationSec < MIN_SONG_SEC) {
        showToast(`"${f.name}"은(는) ${Math.round(analysis.durationSec)}초밖에 안 돼요 — 다운로드가 중간에 끊긴 것 같아요. 다시 받아 주세요.`, { type: "error", duration: 7000 });
        return;
      }

      let id;
      try {
        id = await SF.storage.addSongToLibrary(f);
      } catch (err) {
        console.warn("upload: save failed", err);
        showToast("곡을 저장하지 못했습니다 — 저장 공간이 부족하거나 브라우저가 저장을 막고 있어요(사생활 보호 모드 등).", { type: "error", duration: 7000 });
        return;
      }

      SF.preview.stop();
      if (state.audioURL) URL.revokeObjectURL(state.audioURL);
      state.audioURL = URL.createObjectURL(f);
      state.audioFile = f;
      state.currentSongId = id;
      SF.$("bpmInput").value = analysis.bpm;
      state.phaseOffsetMs = analysis.phaseMs;
      state.previewStartSec = analysis.highlightSec;
      state.songAnalyzed = true;
      SF.$("tapHint").textContent = "자동 측정됨";
      setCurrentSongDisplay(f.name);
      setStartEnabled(true);
      // a freshly uploaded song starts with no custom chart of its own
      state.useCustomChart = false;
      state.customChart = null;
      SF.editor.loadFromCustomChart(null);
      await SF.storage.persistSongMeta();
      await renderSongList();
      renderBestPopup(true);
      scrollActiveSongIntoView(true);
      schedulePreview(0);
      showToast(`"${f.name}" 추가됨 · BPM ${analysis.bpm}`);
    });
  }

  // runs the moment a song becomes current and hasn't been analyzed before —
  // there are no TAP/analyze buttons to press, this just happens on its own.
  // It also finds the song's highlight for the song select preview. If
  // another song gets selected while it's still working, the result is saved
  // to the song it belongs to without touching the screen.
  async function runAutoAnalysis() {
    if (!state.audioFile) return;
    const songId = state.currentSongId, file = state.audioFile;
    analysisRunningFor = songId;
    SF.$("tapHint").textContent = "BPM 분석 중…";
    try {
      const { bpm, phaseMs, highlightSec } = await SF.audioAnalysis.analyzeBPM(file);
      if (state.currentSongId !== songId) {
        SF.storage.updateSongMeta(songId, { bpm, phaseOffsetMs: phaseMs, analyzed: true, previewStart: highlightSec });
        return;
      }
      SF.$("bpmInput").value = bpm;
      state.phaseOffsetMs = phaseMs;
      state.songAnalyzed = true;
      state.previewStartSec = highlightSec;
      SF.$("tapHint").textContent = "자동 측정됨";
      SF.storage.persistSongMeta();
    } catch (err) {
      if (state.currentSongId !== songId) return;
      SF.$("tapHint").textContent = "자동 분석 실패 — 직접 입력하세요";
    } finally {
      if (analysisRunningFor === songId) analysisRunningFor = null;
      if (state.currentSongId === songId) schedulePreview(0);
    }
  }

  function initTempoControls() {
    SF.$("bpmInput").addEventListener("change", () => {
      state.songAnalyzed = true; // a manual correction counts as "settled" — don't overwrite it later
      SF.$("tapHint").textContent = "직접 입력함";
      SF.storage.persistSongMeta();
    });
  }

  function initDifficulty() {
    SF.$("diffGrid").addEventListener("click", (e) => {
      const el = e.target.closest(".diffBtn");
      if (!el) return;
      SF.sfx.unlock();
      if (el.dataset.diff !== state.difficulty) SF.sfx.playMenu("diff");
      setDifficulty(el.dataset.diff);
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
    SF.$("startBtn").addEventListener("click", startSelected);
    SF.$("resumeBtn").addEventListener("click", SF.game.togglePause);
    SF.$("pauseBtn").addEventListener("click", () => { if (state.running) SF.game.togglePause(); });
    SF.$("quitBtn").addEventListener("click", SF.game.quit);
    SF.$("retryBtn").addEventListener("click", retry);
    SF.$("backBtn").addEventListener("click", backToSelect);
  }

  async function restoreFromStorage() {
    await SF.storage.migrateLegacySingleSong();
    try {
      if (await SF.storage.resetScoresIfChartChanged()) {
        showToast("채보 생성 방식이 바뀌어 기존 최고기록을 초기화했습니다.", { duration: 5000 });
      }
    } catch (err) { /* ignore */ }

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
        if (target) { await selectSong(target.id); scrollActiveSongIntoView(false); }
      }
    } catch (err) { /* ignore */ }
  }

  function initSettingsScreen() {
    SF.$("openSettingsBtn").addEventListener("click", () => { SF.sfx.unlock(); SF.sfx.playMenu("select"); showScreen("settings"); });
    SF.$("settingsBackBtn").addEventListener("click", backToSelect);
  }

  function init() {
    SF.screens.setup = SF.$("setupScreen");
    SF.screens.settings = SF.$("settingsScreen");
    SF.screens.game = SF.$("gameScreen");
    SF.screens.result = SF.$("resultScreen");
    SF.screens.editor = SF.$("editorScreen");

    setCurrentSongDisplay(null);
    setStartEnabled(false);
    initMusicUpload();
    initSongTools();
    initTempoControls();
    initDifficulty();
    initSyncOffset();
    initSettingsScreen();
    initStartAndResultButtons();
    initMenuKeys();
  }

  SF.ui = { init, showScreen, renderSongList, selectSong, restoreFromStorage, showToast, wireDangerButton, menuLane };
})();
