// Pattern editor: a scrollable per-lane timeline where notes can be placed
// by click or recorded live (REC) while the song plays, then saved/loaded as
// JSON or sent straight into a test play.
(function () {
  "use strict";

  const state = SF.state;
  const editorNotes = []; // {time(ms), lane}
  const ed = {
    audioEl: null, pxPerSec: 140, gridSubdiv: 2, bpm: 120, phaseOffsetMs: 0,
    playing: false, duration: 180,
  };
  const edLaneTracks = {};
  const edLaneRows = {};

  function cacheLaneEls() {
    SF.LANES.forEach((l) => {
      edLaneRows[l] = document.querySelector(`.edLaneRow[data-lane="${l}"]`);
      edLaneTracks[l] = edLaneRows[l].querySelector(".edLaneTrack");
    });
  }

  function loadFromCustomChart(customChart) {
    editorNotes.length = 0;
    if (customChart) customChart.forEach((n) => editorNotes.push({ time: n.time, lane: n.lane }));
  }

  function openEditor() {
    ed.bpm = Math.max(40, Math.min(300, parseInt(SF.$("bpmInput").value, 10) || 120));
    ed.phaseOffsetMs = state.phaseOffsetMs || 0;
    SF.$("edBpmInput").value = ed.bpm;
    ed.gridSubdiv = parseInt(SF.$("edGridSelect").value, 10);
    ed.pxPerSec = parseInt(SF.$("edZoomSelect").value, 10);
    ed.playing = false;
    state.edRecording = false;
    SF.$("recBtn").classList.remove("on");
    SF.$("edPlayBtn").textContent = "▶ 재생";

    if (ed.audioEl) { ed.audioEl.pause(); }
    ed.audioEl = new Audio(state.audioURL);
    ed.audioEl.preload = "auto";
    ed.audioEl.addEventListener("loadedmetadata", () => {
      ed.duration = isFinite(ed.audioEl.duration) ? ed.audioEl.duration : 180;
      buildEditorTimeline();
    }, { once: true });
    ed.audioEl.addEventListener("pause", () => { ed.playing = false; SF.$("edPlayBtn").textContent = "▶ 재생"; });
    ed.audioEl.addEventListener("ended", () => { ed.playing = false; SF.$("edPlayBtn").textContent = "▶ 재생"; });

    SF.ui.showScreen("editor");
    editorLoop();
  }

  function closeEditor() {
    if (ed.audioEl) ed.audioEl.pause();
    state.edRecording = false;
    SF.$("recBtn").classList.remove("on");
    SF.ui.showScreen("settings"); // the editor is opened from the settings screen now
  }

  function stepMsFor(bpm, subdiv) { return (60000 / bpm) / subdiv; }

  function buildEditorTimeline() {
    const totalPx = Math.max(600, ed.duration * ed.pxPerSec + 200);
    SF.$("editorTimeline").style.width = totalPx + "px";
    SF.$("editorRuler").style.width = totalPx + "px";
    document.querySelectorAll(".edLaneTrack").forEach((t) => { t.style.width = totalPx + "px"; t.innerHTML = ""; });

    // ruler seconds ticks
    const ruler = SF.$("editorRuler");
    ruler.innerHTML = "";
    for (let s = 0; s <= ed.duration; s++) {
      const tick = document.createElement("span");
      tick.style.left = (s * ed.pxPerSec) + "px";
      tick.textContent = s + "s";
      ruler.appendChild(tick);
    }

    // grid lines per lane track
    const stepMs = stepMsFor(ed.bpm, ed.gridSubdiv);
    const beatMs = 60000 / ed.bpm;
    const phase = ((ed.phaseOffsetMs || 0) % stepMs + stepMs) % stepMs;
    SF.LANES.forEach((l) => {
      const track = edLaneTracks[l];
      for (let t = phase; t <= ed.duration * 1000; t += stepMs) {
        const gl = document.createElement("div");
        const beatPos = ((t - (ed.phaseOffsetMs || 0)) % beatMs + beatMs) % beatMs;
        gl.className = "edGridLine" + (beatPos < 1 || beatPos > beatMs - 1 ? " beat" : "");
        gl.style.left = (t / 1000 * ed.pxPerSec) + "px";
        track.appendChild(gl);
      }
    });

    renderEditorNotes();
  }

  function renderEditorNotes() {
    SF.LANES.forEach((l) => { edLaneTracks[l].querySelectorAll(".edNote").forEach((n) => n.remove()); });
    editorNotes.forEach((n) => {
      const el = document.createElement("div");
      el.className = "edNote";
      el.style.left = (n.time / 1000 * ed.pxPerSec) + "px";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = editorNotes.indexOf(n);
        if (idx >= 0) editorNotes.splice(idx, 1);
        renderEditorNotes();
      });
      edLaneTracks[n.lane].appendChild(el);
    });
  }

  function snapTime(rawMs) {
    const stepMs = stepMsFor(ed.bpm, ed.gridSubdiv);
    const phase = ed.phaseOffsetMs || 0;
    return Math.max(0, phase + Math.round((rawMs - phase) / stepMs) * stepMs);
  }

  function recordNote(lane) {
    if (!ed.audioEl) return;
    const raw = ed.audioEl.currentTime * 1000;
    const snapped = snapTime(raw);
    const stepMs = stepMsFor(ed.bpm, ed.gridSubdiv);
    const existingIdx = editorNotes.findIndex((n) => n.lane === lane && Math.abs(n.time - snapped) < stepMs * 0.4);
    if (existingIdx < 0) { editorNotes.push({ time: snapped, lane }); renderEditorNotes(); }
  }

  function editorLoop() {
    if (!SF.screens.editor.classList.contains("active")) return;
    if (ed.audioEl) {
      const x = 110 + ed.audioEl.currentTime * ed.pxPerSec;
      SF.$("editPlayhead").style.left = x + "px";
      SF.$("editTimeVal").textContent = ed.audioEl.currentTime.toFixed(2) + "s";
      // auto-scroll container to keep playhead in view while playing
      if (ed.playing) {
        const body = SF.$("editorBody");
        const viewLeft = body.scrollLeft, viewRight = viewLeft + body.clientWidth;
        if (x < viewLeft + 140 || x > viewRight - 140) { body.scrollLeft = Math.max(0, x - 160); }
      }
    }
    requestAnimationFrame(editorLoop);
  }

  function initListeners() {
    SF.$("openEditorBtn").addEventListener("click", openEditor);
    SF.$("edBackBtn").addEventListener("click", closeEditor);

    SF.LANES.forEach((l) => {
      edLaneTracks[l].addEventListener("click", (e) => {
        const rect = edLaneTracks[l].getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawMs = x / ed.pxPerSec * 1000;
        const snapped = snapTime(rawMs);
        // toggle: remove if a note in this lane already sits within half a step
        const stepMs = stepMsFor(ed.bpm, ed.gridSubdiv);
        const existingIdx = editorNotes.findIndex((n) => n.lane === l && Math.abs(n.time - snapped) < stepMs * 0.4);
        if (existingIdx >= 0) { editorNotes.splice(existingIdx, 1); }
        else { editorNotes.push({ time: snapped, lane: l }); }
        renderEditorNotes();
      });
    });

    SF.$("edBpmInput").addEventListener("change", () => {
      ed.bpm = Math.max(40, Math.min(300, parseInt(SF.$("edBpmInput").value, 10) || 120));
      buildEditorTimeline();
    });
    SF.$("edGridSelect").addEventListener("change", () => {
      ed.gridSubdiv = parseInt(SF.$("edGridSelect").value, 10);
      buildEditorTimeline();
    });
    SF.$("edZoomSelect").addEventListener("change", () => {
      ed.pxPerSec = parseInt(SF.$("edZoomSelect").value, 10);
      buildEditorTimeline();
    });

    SF.$("edPlayBtn").addEventListener("click", () => {
      if (!ed.audioEl) return;
      SF.sfx.unlock();
      if (ed.playing) { ed.audioEl.pause(); ed.playing = false; SF.$("edPlayBtn").textContent = "▶ 재생"; }
      else { ed.audioEl.play(); ed.playing = true; SF.$("edPlayBtn").textContent = "⏸ 일시정지"; }
    });

    SF.$("recBtn").addEventListener("click", () => {
      state.edRecording = !state.edRecording;
      SF.$("recBtn").classList.toggle("on", state.edRecording);
    });

    SF.ui.wireDangerButton(SF.$("edClearBtn"), "정말 지울까요?", () => {
      editorNotes.length = 0;
      renderEditorNotes();
      SF.ui.showToast("모든 노트를 지웠습니다.");
    });

    SF.$("edSaveBtn").addEventListener("click", () => {
      const data = { bpm: ed.bpm, gridSubdiv: ed.gridSubdiv, notes: editorNotes };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pattern_chart.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });

    SF.$("edLoadInput").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data.notes)) throw new Error("invalid");
          editorNotes.length = 0;
          data.notes.forEach((n) => { if (SF.LANES.includes(n.lane) && typeof n.time === "number") editorNotes.push({ time: n.time, lane: n.lane }); });
          if (data.bpm) { ed.bpm = data.bpm; SF.$("edBpmInput").value = ed.bpm; }
          if (data.gridSubdiv) { ed.gridSubdiv = data.gridSubdiv; SF.$("edGridSelect").value = String(data.gridSubdiv); }
          buildEditorTimeline();
        } catch (err) {
          SF.ui.showToast("차트 파일을 읽을 수 없습니다.", { type: "error" });
        }
      };
      reader.readAsText(f);
      e.target.value = "";
    });

    SF.$("edUseAutoBtn").addEventListener("click", () => {
      state.useCustomChart = false;
      SF.ui.updateChartStatus();
      SF.storage.persistSongMeta();
      SF.ui.showToast("자동 생성 패턴으로 전환되었습니다.");
    });

    SF.$("edPlayTestBtn").addEventListener("click", () => {
      if (!editorNotes.length) { SF.ui.showToast("먼저 노트를 배치하거나 REC로 기록해주세요.", { type: "error" }); return; }
      state.customChart = editorNotes.map((n) => ({ time: n.time, lane: n.lane })).sort((a, b) => a.time - b.time);
      state.useCustomChart = true;
      SF.ui.updateChartStatus();
      SF.storage.persistSongMeta();
      if (ed.audioEl) ed.audioEl.pause();
      state.edRecording = false;
      SF.game.startGame();
    });
  }

  function init() {
    cacheLaneEls();
    initListeners();
  }

  SF.editor = { init, recordNote, loadFromCustomChart, get notes() { return editorNotes; } };
})();
