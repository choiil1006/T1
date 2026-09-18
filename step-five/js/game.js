// Core gameplay: countdown, the per-frame note loop, hit judging (including
// hold notes), scoring, HUD, pause/quit, and the results handoff.
(function () {
  "use strict";

  const state = SF.state;
  const laneEls = {};
  const receptorEls = {};
  const HOLD_RELEASE_GRACE_MS = 70;

  function cacheLaneEls() {
    SF.LANES.forEach((l) => {
      laneEls[l] = document.querySelector(`.lane[data-lane="${l}"]`);
      receptorEls[l] = laneEls[l].querySelector(".receptor");
    });
  }

  function startGame() {
    const bpm = Math.max(40, Math.min(300, parseInt(SF.$("bpmInput").value, 10) || 120));
    state.bpm = bpm;

    if (state.audioEl) { state.audioEl.pause(); state.audioEl = null; }
    state.audioEl = new Audio(state.audioURL);
    state.audioEl.preload = "auto";

    state.audioEl.addEventListener("loadedmetadata", () => {
      const dur = isFinite(state.audioEl.duration) ? state.audioEl.duration : 180;
      if (state.useCustomChart && state.customChart && state.customChart.length) {
        state.notes = state.customChart.map((n) => ({
          time: n.time, lane: n.lane, hold: false, holdEnd: null, hit: false, judged: false, el: null, tailEl: null, holdState: null,
        }));
      } else {
        state.notes = SF.chartGenerator.generateChart(state.bpm, state.difficulty, dur, state.phaseOffsetMs);
      }
      beginCountdown();
    }, { once: true });

    state.audioEl.addEventListener("ended", finishGame);

    // reset stats
    state.score = 0; state.combo = 0; state.maxCombo = 0;
    state.counts = { perfect: 0, great: 0, good: 0, bad: 0, miss: 0, empty: 0 };
    state.totalJudged = 0;
    state.paused = false;
    document.querySelectorAll(".note").forEach((n) => n.remove());
    document.querySelectorAll(".holdTail").forEach((n) => n.remove());

    updateHUD();
    SF.ui.showScreen("game");
  }

  function beginCountdown() {
    const cd = SF.$("countdown");
    cd.style.display = "flex";
    let n = 3;
    cd.textContent = n;
    const iv = setInterval(() => {
      n--;
      if (n > 0) { cd.textContent = n; }
      else if (n === 0) { cd.textContent = "GO!"; }
      else {
        clearInterval(iv);
        cd.style.display = "none";
        state.audioEl.currentTime = 0;
        state.audioEl.play();
        state.running = true;
        loop();
      }
    }, 700);
  }

  // perceived song time, corrected for the user's audio-latency calibration
  function currentSongMs() {
    return state.audioEl.currentTime * 1000 - state.syncOffsetMs;
  }

  function loop() {
    if (!state.running) return;
    if (!state.paused) {
      const now = currentSongMs();
      const diff = SF.DIFF[state.difficulty];
      const approach = diff.approach;
      const missWindow = diff.windows.bad;

      for (const note of state.notes) {
        if (note.judged) continue;

        // hold notes already being held: check for completion or early release
        if (note.hold && note.holdState === "holding") {
          const HOLD_TAIL_GRACE = 150; // releasing slightly early near the very end still counts
          const nearEnd = now >= note.holdEnd - HOLD_TAIL_GRACE;
          if (state.laneHeld[note.lane]) {
            note.releasedAt = null;
            if (now >= note.holdEnd - 1) { finalizeHold(note, true); continue; }
          } else if (nearEnd) {
            // let go while already close enough to the end — counts as a clean finish
            finalizeHold(note, true);
            continue;
          } else {
            // released mid-hold: a single dropped polling frame or a dance-pad
            // switch's contact bounce can read as "not held" for just one tick,
            // so don't cancel the hold until it's stayed unheld for a short
            // grace window — only a real release survives that long
            if (note.releasedAt == null) note.releasedAt = now;
            if (now - note.releasedAt >= HOLD_RELEASE_GRACE_MS) {
              finalizeHold(note, false);
              continue;
            }
          }
        }

        const appearAt = note.time - approach;
        const baseDisappear = note.time + missWindow + 40;
        // only extend the disappear window while a hold is actively being held;
        // an UNPRESSED hold note must miss promptly, just like a normal tap
        const effectiveDisappear = (note.hold && note.holdState === "holding")
          ? Math.max(baseDisappear, note.holdEnd + 60)
          : baseDisappear;

        if (now >= appearAt && now <= effectiveDisappear) {
          if (!note.el) {
            const el = document.createElement("div");
            el.className = "note note-" + note.lane;
            laneEls[note.lane].appendChild(el);
            note.el = el;
            if (note.hold) {
              const tail = document.createElement("div");
              tail.className = "holdTail hold-" + note.lane;
              laneEls[note.lane].insertBefore(tail, el);
              note.tailEl = tail;
            }
          }
          let headProgress = (now - appearAt) / approach;
          headProgress = Math.max(0, Math.min(1, headProgress));
          note.el.style.top = (headProgress * 87) + "%";
          note.el.classList.toggle("held", note.holdState === "holding");

          if (note.hold && note.tailEl) {
            const tailAppearAt = note.holdEnd - approach;
            let tailProgress = (now - tailAppearAt) / approach;
            tailProgress = Math.max(0, Math.min(1, tailProgress));
            // the trail reaches well into each panel's own box (the panels
            // are drawn on top — see DOM order — so they simply paint over
            // it there, like layer order in an image editor)
            const laneH = laneEls[note.lane].clientHeight || 1;
            const panelH = receptorEls[note.lane].clientHeight || 0;
            const panelPct = (panelH / laneH) * 100;
            const insertPct = panelPct * 0.7;
            // until the release marker actually enters its own approach
            // window, there's nothing yet to cut the trail's top edge against
            // — rather than show that edge floating in mid-lane, run the top
            // off past the visible arena so the lane's own clipping (see
            // .lane{overflow:hidden}) is what cuts it, like the ribbon is
            // simply continuing down from off-screen
            const topPct = now < tailAppearAt ? -60 : (tailProgress * 87 + panelPct - insertPct);
            const holding = note.holdState === "holding";
            // once actually held, the head panel is hidden (see .note.held)
            // and the judge line is the only thing left to justify a bottom
            // edge — stop exactly there (no insertion past it) and use a
            // flat cut (see the .holdActive clip-path override) instead of
            // the normal slanted corner poking below it
            const bottomPct = holding ? (headProgress * 87) : (headProgress * 87 + insertPct);
            note.tailEl.style.top = topPct + "%";
            note.tailEl.style.height = Math.max(0, bottomPct - topPct) + "%";
            note.tailEl.classList.toggle("holdActive", holding);

            // the release-point arrow only enters once we're actually inside
            // its own approach window (same timing rule as any other note) —
            // it must not sit pinned at the top of the lane before that
            if (now >= tailAppearAt) {
              if (!note.capEl) {
                const cap = document.createElement("div");
                cap.className = "note note-" + note.lane + " tailCap";
                laneEls[note.lane].appendChild(cap);
                note.capEl = cap;
              }
              note.capEl.style.top = (tailProgress * 87) + "%";
              note.capEl.classList.toggle("capHeld", note.holdState === "holding");
            }
          }
        } else if (now > effectiveDisappear) {
          // never hit at all — miss
          if (note.el) { note.el.remove(); note.el = null; }
          if (note.tailEl) { note.tailEl.remove(); note.tailEl = null; }
          if (note.capEl) { note.capEl.remove(); note.capEl = null; }
          note.judged = true;
          registerJudgement("miss", note.lane);
        }
      }
      updateHUD();
    }
    state.rafId = requestAnimationFrame(loop);
  }

  function finalizeHold(note, success) {
    note.judged = true;
    note.holdState = "done"; // critical: stop this note from ever again matching the "currently holding" guard
    if (note.el) {
      note.el.classList.remove("held");
      note.el.classList.add("hitpop");
      const el = note.el; note.el = null;
      setTimeout(() => el.remove(), 200);
    }
    if (note.tailEl) {
      const t = note.tailEl; note.tailEl = null;
      t.style.transition = "opacity .15s";
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 160);
    }
    if (note.capEl) {
      const c = note.capEl; note.capEl = null;
      c.style.transition = "opacity .15s";
      c.style.opacity = "0";
      setTimeout(() => c.remove(), 160);
    }
    registerJudgement(success ? (note.headGrade || "great") : "miss", note.lane);
  }

  function handleHit(lane) {
    if (!state.running || state.paused) return;
    // ignore repeated/auto-repeat presses while a hold in this lane is actively being held
    if (state.notes.some((n) => n.hold && n.holdState === "holding" && !n.judged && n.lane === lane)) return;
    flashReceptor(lane);
    const now = currentSongMs();
    const diff = SF.DIFF[state.difficulty];
    // find closest unjudged note in this lane within the outer (bad) window
    let best = null, bestDelta = Infinity;
    for (const note of state.notes) {
      if (note.judged || note.lane !== lane) continue;
      if (note.hold && note.holdState === "holding") continue;
      const delta = Math.abs(now - note.time);
      if (delta < bestDelta) { bestDelta = delta; best = note; }
    }
    if (best && bestDelta <= diff.windows.bad) {
      let grade;
      if (bestDelta <= diff.windows.perfect) grade = "perfect";
      else if (bestDelta <= diff.windows.great) grade = "great";
      else if (bestDelta <= diff.windows.good) grade = "good";
      else grade = "bad";

      if (best.hold) {
        best.hit = true;
        best.holdState = "holding";
        best.headGrade = grade;
        best.releasedAt = null;
        // note stays alive (judged=false) until the hold resolves in loop()
      } else {
        best.judged = true; best.hit = true;
        if (best.el) { best.el.classList.add("hitpop"); const el = best.el; best.el = null; setTimeout(() => el.remove(), 200); }
      }
      registerJudgement(grade, lane);
    } else {
      // pressed with nothing nearby to hit — a small score penalty for hitting "thin air"
      registerEmptyPress(lane);
    }
  }

  function flashReceptor(lane) {
    const r = receptorEls[lane];
    r.classList.add("flash");
    setTimeout(() => r.classList.remove("flash"), 90);
  }

  function registerJudgement(grade, lane) {
    state.counts[grade]++;
    state.totalJudged++;
    if (grade === "miss") {
      state.combo = 0;
      state.score = Math.max(0, state.score + SF.JUDGE_SCORE.miss);
    } else {
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      const comboMult = 1 + Math.min(state.combo, 50) * 0.01;
      state.score += Math.round(SF.JUDGE_SCORE[grade] * comboMult);
    }
    SF.sfx.playJudge(grade);
    popJudgeText(grade);
    updateHUD();
  }

  function registerEmptyPress(lane) {
    state.counts.empty++;
    state.combo = 0;
    state.score = Math.max(0, state.score - SF.EMPTY_PRESS_PENALTY);
    SF.sfx.playJudge("miss"); // shown the same as a miss — it's an incorrect press either way
    popJudgeText("miss");
    updateHUD();
  }

  function popJudgeText(grade) {
    const jt = SF.$("judgeText");
    jt.textContent = grade === "perfect" ? "PERFECT" : grade === "great" ? "GREAT" : grade === "good" ? "GOOD" : grade === "bad" ? "BAD" : "MISS";
    jt.className = "j-" + grade;
    void jt.offsetWidth;
    jt.classList.add("show");
  }

  function computeAccuracy(c, totalJudged) {
    return totalJudged > 0
      ? ((c.perfect * 100 + c.great * 70 + c.good * 35 + c.bad * 10) / (totalJudged * 100) * 100)
      : 100;
  }

  function updateHUD() {
    SF.$("scoreVal").textContent = state.score;
    SF.$("comboNum").textContent = state.combo;
    SF.$("accVal").textContent = computeAccuracy(state.counts, state.totalJudged).toFixed(1) + "%";
  }

  function togglePause() {
    state.paused = !state.paused;
    SF.$("pauseOverlay").style.display = state.paused ? "flex" : "none";
    if (state.paused) { state.audioEl.pause(); } else { state.audioEl.play(); }
  }

  function quit() {
    state.running = false;
    if (state.audioEl) state.audioEl.pause();
    SF.$("pauseOverlay").style.display = "none";
    document.querySelectorAll(".note").forEach((n) => n.remove());
    document.querySelectorAll(".holdTail").forEach((n) => n.remove());
    SF.ui.showScreen("setup");
  }

  function gradeFor(acc) {
    for (const g of SF.GRADE_THRESHOLDS) if (acc >= g.min) return g.grade;
    return "D";
  }

  async function finishGame() {
    state.running = false;
    document.querySelectorAll(".note").forEach((n) => n.remove());
    document.querySelectorAll(".holdTail").forEach((n) => n.remove());
    const c = state.counts;
    const acc = computeAccuracy(c, state.totalJudged);
    const grade = gradeFor(acc);

    SF.$("rScore").textContent = state.score;
    SF.$("rCombo").textContent = state.maxCombo;
    SF.$("rAcc").textContent = acc.toFixed(1) + "%";
    SF.$("rDiff").textContent = SF.DIFF[state.difficulty].label;
    SF.$("bPerfect").textContent = c.perfect;
    SF.$("bGreat").textContent = c.great;
    SF.$("bGood").textContent = c.good;
    SF.$("bBad").textContent = c.bad;
    SF.$("bMiss").textContent = c.miss;
    SF.$("bEmpty").textContent = c.empty;
    SF.$("gradeLetter").textContent = grade;

    const badge = SF.$("newRecordBadge");
    badge.style.display = "none";
    try {
      const { isNewBest } = await SF.storage.reportScore(state.currentSongId, state.difficulty, {
        score: state.score, maxCombo: state.maxCombo, accuracy: acc, grade, at: Date.now(),
      });
      if (isNewBest) badge.style.display = "block";
    } catch (err) { /* scoreboard is a bonus, never block the result screen on it */ }

    SF.ui.showScreen("result");
  }

  SF.game = { cacheLaneEls, startGame, handleHit, togglePause, quit, finishGame };
})();
