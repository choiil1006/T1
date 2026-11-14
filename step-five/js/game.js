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

  // ---- side-panel / effects state ----
  let shownScore = 0;        // the rolling number on screen, easing toward state.score
  let durationSec = 0;       // song length, for the progress bar
  let countdownToken = 0;    // bumps on quit so a pending countdown never starts the song
  let finished = false;      // finishGame runs once per play
  const MILESTONE_EVERY = 50;
  const hud = {};            // last values written, so the per-frame HUD skips no-op DOM writes

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function setText(id, value) {
    if (hud[id] === value) return;
    hud[id] = value;
    SF.$(id).textContent = value;
  }

  function startGame() {
    const bpm = Math.max(40, Math.min(300, parseInt(SF.$("bpmInput").value, 10) || 120));
    state.bpm = bpm;

    if (state.audioEl) { state.audioEl.pause(); state.audioEl = null; }
    countdownToken++;
    state.running = false;
    finished = false;
    state.audioEl = new Audio(state.audioURL);
    state.audioEl.preload = "auto";

    // left panel: what's playing
    const diffLabel = SF.DIFF[state.difficulty].label;
    SF.$("gSongTitle").textContent = state.currentSongName || "-";
    SF.$("gDiff").textContent = diffLabel;
    SF.$("gDiff").dataset.diff = state.difficulty;
    SF.$("gBpm").textContent = "BPM " + bpm;
    SF.$("gProgress").style.width = "0%";
    SF.$("gTimeNow").textContent = "0:00";
    SF.$("gTimeTotal").textContent = "-:--";
    durationSec = 0;

    state.audioEl.addEventListener("loadedmetadata", () => {
      const dur = isFinite(state.audioEl.duration) ? state.audioEl.duration : 180;
      durationSec = dur;
      SF.$("gTimeTotal").textContent = fmtTime(dur);
      if (state.useCustomChart && state.customChart && state.customChart.length) {
        state.notes = state.customChart.map((n) => ({
          time: n.time, lane: n.lane, hold: false, holdEnd: null, hit: false, judged: false, el: null, tailEl: null, holdState: null,
        }));
      } else {
        state.notes = SF.chartGenerator.generateChart(state.bpm, state.difficulty, dur, state.phaseOffsetMs, state.currentSongId);
      }
      state.maxRawScore = computeMaxRawScore(state.notes);
      beginCountdown();
    }, { once: true });

    state.audioEl.addEventListener("ended", finishGame);

    // reset stats
    state.score = 0; state.rawScore = 0; state.combo = 0; state.maxCombo = 0;
    state.counts = { perfect: 0, great: 0, good: 0, bad: 0, miss: 0, empty: 0 };
    state.totalJudged = 0;
    state.paused = false;
    SF.$("pauseOverlay").style.display = "none";
    clearPlayfield();
    shownScore = 0;
    for (const k in hud) delete hud[k];
    SF.$("milestone").classList.remove("show");
    SF.$("gameScreen").style.setProperty("--beat", 0);
    SF.$("gameScreen").style.setProperty("--heat", 0);

    updateHUD();
    SF.ui.showScreen("game");
  }

  function clearPlayfield() {
    document.querySelectorAll("#lanes .note, #lanes .holdTail, #lanes .hitBeam, #lanes .hitRing").forEach((n) => n.remove());
    document.querySelectorAll("#lanes .lane.missFlash").forEach((l) => l.classList.remove("missFlash"));
  }

  function showCountdown(cd, text) {
    cd.textContent = text;
    cd.classList.remove("tick");
    void cd.offsetWidth;
    cd.classList.add("tick");
  }

  function beginCountdown() {
    const cd = SF.$("countdown");
    const token = countdownToken;
    cd.style.display = "flex";
    let n = 3;
    showCountdown(cd, n);
    const iv = setInterval(() => {
      if (token !== countdownToken) { clearInterval(iv); cd.style.display = "none"; return; }
      n--;
      if (n > 0) { showCountdown(cd, n); }
      else if (n === 0) { showCountdown(cd, "GO!"); }
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

      // beat pulse (1 on the beat, decaying to 0 before the next) and combo
      // "heat" drive the background glow, lane glow and judge line via CSS vars
      const beatMs = 60000 / state.bpm;
      const frac = ((((now - state.phaseOffsetMs) % beatMs) + beatMs) % beatMs) / beatMs;
      const gs = SF.$("gameScreen");
      gs.style.setProperty("--beat", Math.pow(1 - frac, 3).toFixed(3));
      gs.style.setProperty("--heat", Math.min(1, state.combo / 100).toFixed(2));

      if (durationSec > 0) {
        const t = state.audioEl.currentTime;
        SF.$("gProgress").style.width = Math.min(100, t / durationSec * 100).toFixed(2) + "%";
        setText("gTimeNow", fmtTime(t));
      }

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
          headProgress = Math.max(0, headProgress);
          const pinned = note.holdState === "holding"; // actively held -> stays put at the judge line
          // an unpressed note doesn't stop dead at the judge line and then
          // pop out of existence — it keeps sliding on past it, off the
          // bottom of the lane (which clips it — see .lane{overflow:hidden})
          // exactly like it would if you'd just let it fall through
          const headVisualProgress = pinned ? Math.min(1, headProgress) : headProgress;
          note.el.style.top = (headVisualProgress * 87) + "%";
          note.el.classList.toggle("held", pinned);

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
            const holding = pinned;
            // once actually held, the head panel is hidden (see .note.held)
            // and the judge line is the only thing left to justify a bottom
            // edge — stop exactly there (no insertion past it) and use a
            // flat cut (see the .holdActive clip-path override) instead of
            // the normal slanted corner poking below it. If it was never
            // pressed at all, headVisualProgress is the same unclamped value
            // driving the head above, so the tail keeps sliding down with it
            // instead of the head sliding on alone while the tail freezes.
            const bottomPct = holding ? (headVisualProgress * 87) : (headVisualProgress * 87 + insertPct);
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

  function comboMultiplier(combo) {
    return 1 + Math.min(combo, 50) * 0.01;
  }

  // what an all-PERFECT, never-broken run of this chart would total in raw
  // points — a hold counts two judgements (its head and its release)
  function computeMaxRawScore(notes) {
    let judgements = 0;
    for (const n of notes) judgements += n.hold ? 2 : 1;
    let sum = 0;
    for (let k = 1; k <= judgements; k++) sum += Math.round(SF.JUDGE_SCORE.perfect * comboMultiplier(k));
    return sum;
  }

  // the shown/saved score: the raw total scaled so a flawless run is exactly
  // this difficulty's ceiling (a run can never exceed it — combo can't be
  // longer than the number of judgements made so far)
  function syncScore() {
    state.score = state.maxRawScore > 0
      ? Math.round(state.rawScore / state.maxRawScore * SF.MAX_SCORE[state.difficulty])
      : 0;
  }

  function registerJudgement(grade, lane) {
    state.counts[grade]++;
    state.totalJudged++;
    if (grade === "miss") {
      state.combo = 0;
      state.rawScore = Math.max(0, state.rawScore + SF.JUDGE_SCORE.miss);
    } else {
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.rawScore += Math.round(SF.JUDGE_SCORE[grade] * comboMultiplier(state.combo));
    }
    syncScore();
    SF.sfx.playJudge(grade);
    popJudgeText(grade);
    if (grade === "miss") missFlash(lane); else hitFx(lane, grade);
    bumpCombo();
    if (grade !== "miss" && state.combo % MILESTONE_EVERY === 0) showMilestone(state.combo);
    updateHUD();
  }

  function registerEmptyPress(lane) {
    state.counts.empty++;
    state.combo = 0;
    state.rawScore = Math.max(0, state.rawScore - SF.EMPTY_PRESS_PENALTY);
    syncScore();
    SF.sfx.playJudge("miss"); // shown the same as a miss — it's an incorrect press either way
    popJudgeText("miss");
    missFlash(lane);
    updateHUD();
  }

  // a light beam up the lane plus a diamond ring bursting off the receptor
  function hitFx(lane, grade) {
    const laneEl = laneEls[lane];
    if (!laneEl) return;
    const perfect = grade === "perfect";
    const beam = document.createElement("div");
    beam.className = "hitBeam" + (perfect ? " perfect" : "");
    const ring = document.createElement("div");
    ring.className = "hitRing" + (perfect ? " perfect" : "");
    laneEl.insertBefore(beam, laneEl.firstChild); // under the notes
    laneEl.appendChild(ring);
    // timer rather than animationend: that never fires when animations are
    // off (reduced motion, background tab) and the elements would pile up
    setTimeout(() => { beam.remove(); ring.remove(); }, 380);
  }

  function missFlash(lane) {
    const laneEl = laneEls[lane];
    if (!laneEl) return;
    laneEl.classList.remove("missFlash");
    void laneEl.offsetWidth;
    laneEl.classList.add("missFlash");
    clearTimeout(laneEl._missTimer);
    laneEl._missTimer = setTimeout(() => laneEl.classList.remove("missFlash"), 320);
  }

  function bumpCombo() {
    const wrap = SF.$("comboWrap");
    wrap.classList.toggle("zero", state.combo < 2);
    if (state.combo < 2) return;
    wrap.classList.remove("bump");
    void wrap.offsetWidth;
    wrap.classList.add("bump");
  }

  function showMilestone(combo) {
    const m = SF.$("milestone");
    m.textContent = combo + " COMBO!";
    m.classList.remove("show");
    void m.offsetWidth;
    m.classList.add("show");
    SF.sfx.playMenu("milestone");
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

  // called every frame while playing and after every judgement: the score
  // rolls toward its real value instead of jumping
  function updateHUD() {
    const gap = state.score - shownScore;
    shownScore = Math.abs(gap) < 2 ? state.score : shownScore + gap * 0.22;
    setText("scoreVal", Math.round(shownScore).toLocaleString());
    setText("comboNum", String(state.combo));
    SF.$("comboWrap").classList.toggle("zero", state.combo < 2);
    const acc = computeAccuracy(state.counts, state.totalJudged);
    setText("accVal", acc.toFixed(1) + "%");
    const c = state.counts;
    setText("gcPerfect", String(c.perfect));
    setText("gcGreat", String(c.great));
    setText("gcGood", String(c.good));
    setText("gcBad", String(c.bad));
    setText("gcMiss", String(c.miss + c.empty));
    setText("gGrade", state.totalJudged + c.empty > 0 ? gradeFor(acc) : "-");
  }

  function togglePause() {
    state.paused = !state.paused;
    SF.$("pauseOverlay").style.display = state.paused ? "flex" : "none";
    if (state.paused) { state.audioEl.pause(); } else { state.audioEl.play(); }
  }

  function quit() {
    state.running = false;
    countdownToken++;
    if (state.audioEl) state.audioEl.pause();
    SF.$("pauseOverlay").style.display = "none";
    clearPlayfield();
    SF.sfx.playMenu("back");
    SF.ui.showScreen("setup");
  }

  function gradeFor(acc) {
    for (const g of SF.GRADE_THRESHOLDS) if (acc >= g.min) return g.grade;
    return "D";
  }

  async function finishGame() {
    if (finished) return;
    finished = true;
    state.running = false;
    clearPlayfield();
    const c = state.counts;
    const acc = computeAccuracy(c, state.totalJudged);
    const grade = gradeFor(acc);

    SF.$("rSongTitle").textContent = state.currentSongName || "-";
    SF.$("rDiff").textContent = SF.DIFF[state.difficulty].label;
    SF.$("rDiff").dataset.diff = state.difficulty;
    SF.$("rScore").textContent = "0";
    SF.$("rCombo").textContent = state.maxCombo;
    SF.$("rAcc").textContent = acc.toFixed(1) + "%";
    const bars = { perfect: "bPerfect", great: "bGreat", good: "bGood", bad: "bBad", miss: "bMiss" };
    const total = Math.max(1, c.perfect + c.great + c.good + c.bad + c.miss);
    Object.entries(bars).forEach(([k, id]) => {
      const b = SF.$(id);
      b.textContent = c[k];
      b.parentElement.querySelector("em").style.width = "0%";
    });
    SF.$("bEmpty").textContent = c.empty;
    SF.$("gradeLetter").textContent = grade;

    const badge = SF.$("newRecordBadge");
    badge.style.display = "none";
    try {
      const { isNewBest } = await SF.storage.reportScore(state.currentSongId, state.difficulty, {
        score: state.score, maxCombo: state.maxCombo, accuracy: acc, grade, at: Date.now(),
      });
      if (isNewBest) badge.style.display = "inline-block";
    } catch (err) { /* scoreboard is a bonus, never block the result screen on it */ }

    // staged reveal: bars grow and the score counts up, then the grade
    // stamps in (CSS delays on #resultScreen.reveal)
    const rs = SF.$("resultScreen");
    rs.classList.remove("reveal");
    SF.ui.showScreen("result");
    void rs.offsetWidth;
    rs.classList.add("reveal");
    setTimeout(() => {
      Object.entries(bars).forEach(([k, id]) => {
        SF.$(id).parentElement.querySelector("em").style.width = (c[k] / total * 100).toFixed(1) + "%";
      });
    }, 60);
    countUp(SF.$("rScore"), state.score, 1000);
  }

  function countUp(el, target, ms) {
    const t0 = performance.now();
    let done = false;
    const step = (t) => {
      if (done) return;
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(step); else done = true;
    };
    requestAnimationFrame(step);
    // guarantees the final number even if frames aren't being drawn
    setTimeout(() => { done = true; el.textContent = target.toLocaleString(); }, ms + 80);
  }

  SF.game = { cacheLaneEls, startGame, handleHit, togglePause, quit, finishGame };
})();
