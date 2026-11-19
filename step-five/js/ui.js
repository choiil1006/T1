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
      if (!rec.blob.size) {
        showToast(`"${rec.name}"은(는) 빈 파일(0바이트)로 저장돼 있어요. 같은 이름의 정상 파일을 다시 올리면 자동으로 바뀌어요.`, { type: "error", duration: 8000 });
      }
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

  // EASY -> NORMAL -> HARD -> EASY
  function cycleDifficulty() {
    const i = DIFFS.indexOf(state.difficulty);
    SF.sfx.playMenu("diff");
    setDifficulty(DIFFS[(i + 1) % DIFFS.length]);
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
  //   song select:  ↙ previous song  ↘ next song  ⊙ random song
  //                 ↖ next difficulty (HARD wraps to EASY)  ↗ start
  //   result:       ⊙ back to song select  ↗ play again
  function menuLane(lane) {
    SF.sfx.unlock();
    const screen = document.body.dataset.screen;
    if (screen === "setup") {
      if (lane === "DL") moveSong(-1);
      else if (lane === "DR") moveSong(1);
      else if (lane === "CN") pickRandomSong();
      else if (lane === "UL") cycleDifficulty();
      else if (lane === "UR") startSelected();
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

  // Brings one picked file into the library. Never touches the selection —
  // the caller does that once at the end of a batch. Returns
  // {status: "added"|"replaced"|"exists"|"failed", name, id?, bpm?, reason?}
  async function importOneFile(picked) {
    const name = picked.name;
    // copy the bytes in now, while the file is certainly reachable — a file
    // on a USB stick, phone or network folder may stop being readable later
    let f;
    try {
      f = new File([await picked.arrayBuffer()], name, { type: picked.type || "audio/mpeg", lastModified: picked.lastModified });
    } catch (err) {
      console.warn("upload: cannot read file", name, err);
      return { status: "failed", name, reason: `파일 내용을 읽을 수 없어요 (${err && err.name ? err.name : "Error"}). 내 컴퓨터의 다운로드/음악 폴더로 복사한 뒤 다시 올려 주세요.` };
    }

    // the same song again (often re-picked after thinking it failed): keep
    // the one already there — unless the stored copy is broken/different
    // (e.g. an empty file saved by an older version), which gets replaced
    let replaceId = null;
    const existing = songIndexCache.find((s) => s.name === name);
    if (existing) {
      const rec = await SF.storage.idbGet("song:" + existing.id);
      if (rec && rec.blob && rec.blob.size > 0 && rec.blob.size === f.size) return { status: "exists", name, id: existing.id };
      replaceId = existing.id;
    }

    // decode + analyze BEFORE adding it, so a file the browser can't read
    // gets a clear reason instead of becoming a broken library entry
    let analysis;
    try {
      analysis = await SF.audioAnalysis.analyzeBPM(f);
    } catch (err) {
      console.warn("upload: cannot decode", name, f.type, f.size, err);
      if (SF.audioAnalysis.isFileProblem(err)) return { status: "failed", name, reason: await SF.audioAnalysis.describeUnreadable(f) };
      // not the file's fault: memory, audio system, browser limits…
      const what = `${err && err.name ? err.name : "Error"}${err && err.message ? ": " + err.message : ""}`;
      return { status: "failed", name, reason: `처리 중 브라우저 오류 (${what}). 메모리 부족이나 오디오 장치 문제일 수 있어요 — diag.html에서 확인해 주세요.` };
    }
    // a few seconds of audio (a broken download, a ringtone clip) can't
    // carry a chart: notes need a 4-beat lead-in and the last 3 s stay empty
    if (analysis.durationSec < MIN_SONG_SEC) {
      return { status: "failed", name, reason: `${Math.round(analysis.durationSec)}초밖에 안 돼요 — 다운로드가 중간에 끊긴 것 같아요.` };
    }

    let id;
    try {
      id = await SF.storage.addSongToLibrary(f);
      await SF.storage.updateSongMeta(id, {
        bpm: analysis.bpm, phaseOffsetMs: analysis.phaseMs, previewStart: analysis.highlightSec,
        analyzed: true, useCustomChart: false, customChart: null,
      });
    } catch (err) {
      console.warn("upload: save failed", err);
      return { status: "failed", name, reason: "저장하지 못했어요 — 저장 공간이 부족하거나 브라우저가 저장을 막고 있어요(사생활 보호 모드 등)." };
    }
    // a broken copy with the same name is replaced by this good one
    if (replaceId) {
      try {
        await SF.storage.deleteSongRecord(replaceId);
        await SF.storage.setSongIndex((await SF.storage.getSongIndex()).filter((s) => s.id !== replaceId));
      } catch (err) { console.warn("upload: removing the old copy failed", err); }
    }
    // keep the duplicate check current for the rest of this batch
    songIndexCache = songIndexCache.filter((s) => s.id !== replaceId).concat([{ id, name, addedAt: Date.now() }]);
    return { status: replaceId ? "replaced" : "added", name, id, bpm: analysis.bpm };
  }

  const STATUS_TEXT = { added: "추가", replaced: "망가진 기존 파일 교체", exists: "이미 있음", failed: "실패" };

  function showUploadReport(results) {
    const box = SF.$("uploadReport");
    box.textContent = "";
    results.forEach((r) => {
      const row = document.createElement("div");
      row.className = "upRow " + r.status;
      const head = document.createElement("b");
      head.textContent = `${STATUS_TEXT[r.status]}${r.bpm ? " · BPM " + r.bpm : ""}`;
      const nm = document.createElement("span");
      nm.textContent = r.name;
      row.append(head, nm);
      if (r.reason) { const why = document.createElement("small"); why.textContent = r.reason; row.appendChild(why); }
      box.appendChild(row);
    });
    box.style.display = results.length ? "flex" : "none";
  }

  let importing = false;

  function initMusicUpload() {
    SF.$("audioFile").addEventListener("change", (e) => {
      const files = [...e.target.files];
      // clear right away: picking the same file again (e.g. after a failed
      // attempt) must still fire "change"
      e.target.value = "";
      if (!files.length) return;
      if (importing) { showToast("곡을 불러오는 중이에요. 끝난 뒤 다시 골라 주세요."); return; }
      SF.sfx.unlock();
      importFiles(files, { select: true, label: "" });
    });
  }

  // Imports a list of Files, or {name, load: async () => File} items that are
  // only fetched when their turn comes (the song folder). Shows progress
  // under the picker, the per-file report, and a summary toast.
  //   select: select the last song that came in (not for background syncs,
  //           which must never change the song under a game that's running)
  //   label:  prefix for the progress/summary text ("곡 폴더: ")
  //   yieldToGame: wait while a song is being played (keeps play smooth on a Pi)
  async function importFiles(items, { select = true, label = "", yieldToGame = false } = {}) {
    importing = true;
    const pickerLabel = SF.$("fileLabel"), status = SF.$("uploadStatus");
    pickerLabel.classList.add("busy");
    if (select) SF.preview.stop();

    const results = [];
    try {
      for (let i = 0; i < items.length; i++) {
        while (yieldToGame && state.running) await new Promise((r) => setTimeout(r, 1000));
        const name = items[i].name;
        const msg = items.length > 1 ? `${label}불러오는 중 ${i + 1}/${items.length} — ${name}` : `${label}"${name}" 불러오는 중…`;
        status.textContent = msg;
        if (i === 0) showToast(items.length > 1 ? `${label}${items.length}곡 불러오는 중… (설정 → 음악에서 진행 상황 확인)` : msg, { duration: 2000 });
        let file = items[i];
        if (typeof file.load === "function") {
          try { file = await file.load(); }
          catch (err) { results.push({ status: "failed", name, reason: `곡 폴더에서 가져오지 못했어요 (${err && err.message ? err.message : err})` }); continue; }
        }
        results.push(await importOneFile(file));
      }
    } finally {
      importing = false;
      pickerLabel.classList.remove("busy");
      status.textContent = "";
    }

    await renderSongList();
    showUploadReport(results);
    const count = (s) => results.filter((r) => r.status === s).length;
    const added = count("added") + count("replaced"), exists = count("exists"), failed = count("failed");

    // select the last song that came in (or, if all were already there, the last of those)
    if (select && !state.running) {
      const target = [...results].reverse().find((r) => r.status === "added" || r.status === "replaced") ||
                     [...results].reverse().find((r) => r.status === "exists");
      if (target) { await selectSong(target.id); scrollActiveSongIntoView(true); }
    }

    if (items.length === 1 && !label) {
      const r = results[0];
      if (r.status === "failed") showToast(`"${r.name}"을(를) 읽을 수 없습니다 — ${r.reason}`, { type: "error", duration: 9000 });
      else if (r.status === "exists") showToast(`"${r.name}"은(는) 이미 목록에 있어서 그 곡을 선택했어요.`);
      else if (r.status === "replaced") showToast(`"${r.name}"의 망가진 기존 파일을 새 파일로 바꿨어요 · BPM ${r.bpm}`);
      else showToast(`"${r.name}" 추가됨 · BPM ${r.bpm}`);
    } else {
      const parts = [`${label}${added}곡 추가`];
      if (exists) parts.push(`${exists}곡 이미 있음`);
      if (failed) parts.push(`${failed}곡 실패`);
      showToast(parts.join(" · ") + (failed ? " — 실패 이유는 설정 → 음악에서 확인하세요." : ""), { type: failed ? "error" : "info", duration: failed ? 9000 : 4000 });
    }
    return results;
  }

  // ---- song folder (game served by pi/server.py on the Raspberry Pi) ----
  // The server lists a folder of audio files at songs/index.json. On every
  // start (and from Settings) any file there that isn't in the library yet —
  // same name and size — is fetched and imported like a normal upload. When
  // the game runs elsewhere (GitHub Pages, a plain file server) that address
  // doesn't exist and this stays silent.
  let folderInfo = null; // {folder, count, checkedAt} once a folder server answered

  function renderFolderCard() {
    const card = SF.$("songFolderCard");
    if (!folderInfo) { card.style.display = "none"; return; }
    card.style.display = "block";
    SF.$("songFolderPath").textContent = folderInfo.folder || "songs";
    SF.$("songFolderStatus").textContent =
      `폴더에 ${folderInfo.count}곡 · 마지막 확인 ${new Date(folderInfo.checkedAt).toLocaleTimeString()}`;
  }

  async function syncSongFolder({ manual = false } = {}) {
    if (importing) { if (manual) showToast("곡을 불러오는 중이에요. 끝난 뒤 다시 눌러 주세요."); return; }
    let data;
    try {
      const res = await fetch("songs/index.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json();
      if (!data || !Array.isArray(data.songs)) throw new Error("bad index");
    } catch (err) {
      if (manual) showToast("곡 폴더를 찾을 수 없어요 — 라즈베리파이의 게임 서버(pi/server.py)로 켰을 때만 동작해요.", { type: "error", duration: 7000 });
      return;
    }
    folderInfo = { folder: data.folder, count: data.songs.length, checkedAt: Date.now() };
    renderFolderCard();

    // what the library already has, by name -> stored size
    const have = new Map();
    for (const s of await SF.storage.getSongIndex()) {
      const rec = await SF.storage.idbGet("song:" + s.id);
      have.set(s.name.normalize("NFC"), rec && rec.blob ? rec.blob.size : 0);
    }
    const todo = data.songs.filter((s) => have.get(String(s.name).normalize("NFC")) !== s.size);
    if (!todo.length) { if (manual) showToast(`곡 폴더에 새 곡이 없어요 (${data.songs.length}곡 모두 목록에 있음).`); return; }

    await importFiles(todo.map((s) => ({
      name: s.name,
      load: async () => {
        const res = await fetch(s.url, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        return new File([blob], s.name, { type: blob.type || "audio/mpeg", lastModified: s.mtime || Date.now() });
      },
    })), { select: false, label: "곡 폴더: ", yieldToGame: true });
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

    // new songs dropped into the Pi's song folder come in on every start
    try {
      await syncSongFolder();
      if (!state.currentSongId && !state.running) {
        const list = visibleSongs();
        if (list.length) { await selectSong(list[0].id); scrollActiveSongIntoView(false); }
      }
    } catch (err) { console.warn("song folder sync failed", err); }
  }

  function initSettingsScreen() {
    SF.$("openSettingsBtn").addEventListener("click", () => { SF.sfx.unlock(); SF.sfx.playMenu("select"); showScreen("settings"); });
    SF.$("settingsBackBtn").addEventListener("click", backToSelect);
    SF.$("songFolderSyncBtn").addEventListener("click", () => syncSongFolder({ manual: true }));
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
