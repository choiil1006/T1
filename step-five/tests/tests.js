// STEP FIVE automated checks (open tests.html). Four groups:
//  1. audio features — the low/high bands really separate kicks from hats
//  2. chart rules — every generated chart, across tempos/lengths/difficulties,
//     obeys the generator's guarantees
//  3. playback clock — the Web Audio song clock runs smoothly forward
//  4. autoplay — the real game (index.html in the frame below) is played
//     note-perfectly and with deliberate misses, and the results must match
(function () {
  "use strict";

  const out = document.getElementById("out");
  const summary = document.getElementById("summary");
  const results = { pass: 0, fail: 0, skip: 0, done: false, failures: [] };
  window.__testResults = results;

  function group(name) {
    const d = document.createElement("div");
    d.className = "group";
    d.textContent = "■ " + name;
    out.appendChild(d);
  }
  function report(kind, name, detail) {
    results[kind]++;
    if (kind === "fail") results.failures.push(name + (detail ? " — " + detail : ""));
    const d = document.createElement("div");
    d.className = "row " + kind;
    d.textContent = (kind === "pass" ? "PASS " : kind === "fail" ? "FAIL " : "SKIP ") + name + (detail ? " — " + detail : "");
    out.appendChild(d);
  }
  function check(name, ok, detail) { report(ok ? "pass" : "fail", name, ok ? "" : detail); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (fn()) return true; await sleep(50); }
    return false;
  }

  // ---------- synthetic music ----------
  // A section: kick every beat, hat on every off-beat.
  // B section: kick on 1 & 3, snare on 2 & 4, hats on 16ths.
  // Structure A A B B A A (8 bars each) — repeats so reuse can be checked.
  function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
  function synthSong(bpm, sec, sr = 22050) {
    const n = Math.floor(sec * sr);
    const data = new Float32Array(n);
    const noise = lcg(12345);
    const beat = 60 / bpm;
    const add = (t0, len, fn) => {
      const a = Math.floor(t0 * sr), b = Math.min(n, a + Math.floor(len * sr));
      for (let i = a; i < b; i++) data[i] += fn((i - a) / sr);
    };
    for (let k = 0; k * beat < sec; k++) {
      const t = k * beat;
      const bar = Math.floor(k / 4), inBar = k % 4;
      const section = Math.floor(bar / 8) % 6; // A A B B A A
      const isB = section === 2 || section === 3;
      if (!isB || inBar % 2 === 0) add(t, 0.22, (x) => 0.9 * Math.exp(-x * 22) * Math.sin(2 * Math.PI * 55 * x));
      if (isB && inBar % 2 === 1) add(t, 0.15, (x) => 0.45 * Math.exp(-x * 28) * noise());
      const hats = isB ? [0.25, 0.5, 0.75] : [0.5];
      hats.forEach((f) => {
        let prev = 0;
        add(t + f * beat, 0.05, (x) => { const v = noise(); const h = v - prev; prev = v; return 0.3 * Math.exp(-x * 90) * h; });
      });
    }
    return { data, sr };
  }
  function monoBuffer({ data, sr }) {
    return { numberOfChannels: 1, sampleRate: sr, length: data.length, duration: data.length / sr, getChannelData: () => data };
  }
  function wavBlob({ data, sr }) {
    const buf = new ArrayBuffer(44 + data.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + data.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, data.length * 2, true);
    for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32000, true);
    return new Blob([buf], { type: "audio/wav" });
  }

  // ---------- 1. audio features ----------
  function testFeatures() {
    group("음원 분석 (대역별 특징)");
    const bpm = 120, song = synthSong(bpm, 12);
    const f = SF.audioAnalysis.computeFeatures(monoBuffer(song));
    const beatF = (k) => Math.round(k * 0.5 * f.fps); // 120 bpm = 0.5 s per beat
    const peak = (arr, c) => Math.max(...[-2, -1, 0, 1, 2].map((d) => arr[c + d] || 0));
    let lowOn = 0, lowOff = 0, highOn = 0, highOff = 0, cnt = 0;
    for (let k = 2; k < 20; k++) { // section A only
      lowOn += peak(f.low, beatF(k)); lowOff += peak(f.low, beatF(k + 0.5));
      highOn += peak(f.high, beatF(k)); highOff += peak(f.high, beatF(k + 0.5));
      cnt++;
    }
    check("특징 배열 길이가 곡 길이와 일치", Math.abs(f.full.length - 12 * f.fps) <= 2, `${f.full.length} vs ${(12 * f.fps).toFixed(1)}`);
    // frame timing must not drift: the kick at 10.0 s peaks at frame 10*fps (22.05 kHz has a rounded hop)
    const c10 = Math.round(10 * f.fps);
    let arg = c10 - 10;
    for (let i = c10 - 10; i <= c10 + 10; i++) if (f.low[i] > f.low[arg]) arg = i;
    check("10초 지점 킥이 정확한 프레임에 잡힘 (시간 드리프트 없음)", Math.abs(arg - c10) <= 2, `frame ${arg} vs ${c10}`);
    check("저음 대역이 킥(정박)에서 더 강함", lowOn > lowOff * 2, `on ${(lowOn / cnt).toFixed(2)} / off ${(lowOff / cnt).toFixed(2)}`);
    check("고음 대역이 하이햇(엇박)에서 더 강함", highOff > highOn * 1.5, `off ${(highOff / cnt).toFixed(2)} / on ${(highOn / cnt).toFixed(2)}`);
    check("값이 0~1 범위", [f.full, f.low, f.high].every((a) => a.every((x) => x >= 0 && x <= 1)));
  }

  // ---------- 2. chart rules ----------
  function chartProblems(notes, bpm, difficulty, durationSec) {
    const diff = SF.DIFF[difficulty];
    const stepMs = 60000 / bpm / diff.subdiv;
    const endMs = durationSec * 1000 - SF.chartGenerator.QUIET_TAIL_MS;
    const probs = [];
    for (let i = 1; i < notes.length; i++) if (notes[i].time < notes[i - 1].time) { probs.push("정렬 안 됨"); break; }
    notes.forEach((n) => {
      if (n.time < 0 || n.time >= endMs) probs.push(`범위 밖 노트 ${n.time.toFixed(0)}ms`);
      if (n.hold && n.holdEnd > endMs) probs.push(`마지막 3초 안에 끝나는 홀드 ${n.holdEnd.toFixed(0)}`);
      if (n.hold && n.lane === "CN") probs.push("CN 홀드");
      if (!SF.LANES.includes(n.lane)) probs.push("잘못된 레인 " + n.lane);
    });
    const holds = notes.filter((n) => n.hold);
    notes.forEach((n) => {
      const same = notes.filter((m) => Math.abs(m.time - n.time) < 0.5);
      const active = holds.filter((h) => h !== n && h.time <= n.time + 0.5 && n.time < h.holdEnd && !same.includes(h));
      if (active.length + same.length > 2) probs.push(`동시에 3개 이상 @${n.time.toFixed(0)}`);
      if (same.length >= 2 && active.length) probs.push(`홀드 중 점프 @${n.time.toFixed(0)}`);
      if (active.some((h) => h.lane === n.lane)) probs.push(`홀드 중인 레인에 노트 @${n.time.toFixed(0)}`);
    });
    SF.LANES.forEach((l) => {
      const ln = notes.filter((n) => n.lane === l);
      for (let i = 1; i < ln.length; i++) {
        const prevEnd = ln[i - 1].hold ? ln[i - 1].holdEnd : ln[i - 1].time;
        if (ln[i].time - prevEnd < stepMs * 1.3 - 0.5) { probs.push(`같은 레인 간격 부족 ${l} @${ln[i].time.toFixed(0)}`); break; }
      }
    });
    return [...new Set(probs)];
  }

  // windows of 4 beats -> lane signature, to count reused / mirrored segments
  function repeatedWindows(notes, bpm, phaseMs) {
    const beatMs = 60000 / bpm, seg = beatMs * 4;
    const start = phaseMs + beatMs * 4;
    const mirror = { DL: "DR", UL: "UR", CN: "CN", UR: "UL", DR: "DL" };
    const sigs = new Map();
    notes.forEach((n) => {
      const k = Math.floor((n.time - start) / seg);
      if (!sigs.has(k)) sigs.set(k, []);
      sigs.get(k).push(Math.round(n.time - start - k * seg) + n.lane + (n.hold ? "h" : ""));
    });
    const seen = new Set();
    let repeats = 0;
    [...sigs.keys()].sort((a, b) => a - b).forEach((k) => {
      const s = sigs.get(k).join(",");
      const m = sigs.get(k).map((x) => x.replace(/(DL|UL|CN|UR|DR)/, (l) => mirror[l])).join(",");
      if (s.length > 12 && (seen.has(s) || seen.has(m))) repeats++;
      seen.add(s);
    });
    return { repeats, windows: sigs.size };
  }

  function testCharts() {
    group("채보 규칙");
    const gen = SF.chartGenerator.generateChart;
    const featCache = {};
    const featuresFor = (bpm, sec) => {
      const key = bpm + "|" + sec;
      if (!featCache[key]) featCache[key] = SF.audioAnalysis.computeFeatures(monoBuffer(synthSong(bpm, sec)));
      return featCache[key];
    };
    const cases = [];
    [92, 128, 150, 185].forEach((bpm) => [35, 120].forEach((sec) => [true, false].forEach((withF) => cases.push({ bpm, sec, withF }))));
    let total = 0, bad = 0;
    const densities = { easy: [], normal: [] };
    cases.forEach(({ bpm, sec, withF }) => {
      const feats = withF ? featuresFor(bpm, sec) : null;
      ["easy", "normal", "hard"].forEach((d) => {
        const notes = gen(bpm, d, sec, 0, "test-" + bpm + "-" + sec, feats);
        total++;
        const probs = chartProblems(notes, bpm, d, sec);
        if (probs.length) { bad++; report("fail", `규칙 위반 ${d} ${bpm}BPM ${sec}s${withF ? "" : " (분석 없음)"}`, probs.slice(0, 4).join(" / ")); }
        if (withF && d !== "hard") {
          const beats = (sec * 1000 - 3000 - 4 * 60000 / bpm) / (60000 / bpm);
          densities[d].push(notes.length / Math.max(1, beats));
        }
      });
    });
    check(`${total}개 채보 모두 규칙 준수 (정렬·마지막 3초·CN 홀드 금지·동시 2개 이하·같은 레인 간격)`, bad === 0, `${bad}개 위반`);

    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    check("EASY 밀도 (박자당 0.35~1.1 노트)", avg(densities.easy) > 0.35 && avg(densities.easy) < 1.1, avg(densities.easy).toFixed(2));
    check("NORMAL 밀도 (박자당 0.7~2.0 노트)", avg(densities.normal) > 0.7 && avg(densities.normal) < 2.0, avg(densities.normal).toFixed(2));

    const f = featuresFor(128, 120);
    const strip = (ns) => JSON.stringify(ns.map((n) => [n.time, n.lane, n.hold, n.holdEnd]));
    const a = gen(128, "normal", 120, 0, "same-song", f), b = gen(128, "normal", 120, 0, "same-song", f);
    check("같은 곡·난이도는 항상 같은 채보", strip(a) === strip(b));
    const h = gen(128, "hard", 120, 0, "same-song", f);
    check("NORMAL과 HARD는 같은 채보 (의도된 설계)", strip(a) === strip(h));
    const other = gen(128, "normal", 120, 0, "other-song", f);
    check("다른 곡이면 다른 채보", strip(a) !== strip(other));

    const jumps = (() => { const c = {}; a.forEach((n) => { c[n.time] = (c[n.time] || 0) + 1; }); return Object.values(c).filter((x) => x === 2).length; })();
    check("NORMAL에 점프(동시 밟기)가 등장", jumps > 0, "점프 0개");
    check("홀드 노트가 등장", a.some((n) => n.hold), "홀드 0개");
    const e = gen(128, "easy", 120, 0, "same-song", f);
    const eJumps = (() => { const c = {}; e.forEach((n) => { c[n.time] = (c[n.time] || 0) + 1; }); return Object.values(c).filter((x) => x > 1).length; })();
    check("EASY에는 점프 없음", eJumps === 0, eJumps + "개");

    const rep = repeatedWindows(a, 128, 0);
    check("반복되는 구간에서 같은(또는 좌우 반전) 패턴 재사용", rep.repeats >= 3, `${rep.repeats}/${rep.windows} 구간`);

    // foot flow: two quick single steps on the SAME side (e.g. DL then UL
    // within a beat) force one foot to cross over the other — the
    // alternating-feet model should make that rare (holds excepted, where
    // the free foot legitimately works one side)
    const side = { DL: "L", UL: "L", UR: "R", DR: "R", CN: "C" };
    const holdsA = a.filter((n) => n.hold);
    let sameSide = 0, fast = 0;
    for (let i = 1; i < a.length; i++) {
      const p = a[i - 1], q = a[i];
      if (p.time === q.time || (a[i + 1] && a[i + 1].time === q.time) || (a[i - 2] && a[i - 2].time === p.time)) continue;
      if (q.time - p.time >= 60000 / 128) continue;
      if (holdsA.some((h) => h.time <= q.time && q.time < h.holdEnd)) continue;
      fast++;
      if (side[p.lane] !== "C" && side[p.lane] === side[q.lane]) sameSide++;
    }
    check("빠른 연속 스텝이 같은 쪽에 몰려 다리가 꼬이는 경우 드묾 (<5%)", fast > 20 && sameSide / fast < 0.05, `${sameSide}/${fast}`);
  }

  // ---------- 3. playback clock ----------
  async function testClock() {
    group("재생 시계 (Web Audio)");
    const ctx = SF.sfx.context();
    try { await Promise.race([ctx.resume(), sleep(300)]); } catch (e) { /* ignore */ }
    if (ctx.state !== "running") { report("skip", "오디오가 잠겨 있음 — 페이지를 한 번 클릭하고 '다시 실행'을 누르면 확인합니다"); return; }
    // a freshly started output device can take a moment before its clock runs
    const c0 = ctx.currentTime;
    await waitFor(() => ctx.currentTime > c0 + 0.2, 2000);
    const blob = wavBlob(synthSong(120, 4));
    await SF.player.load("clock-test", blob);
    SF.player.play(0);
    const samples = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 700) { samples.push([performance.now(), SF.player.time()]); await sleep(15); }
    SF.player.stop();
    let monotonic = true;
    for (let i = 1; i < samples.length; i++) if (samples[i][1] < samples[i - 1][1] - 1e-6) monotonic = false;
    check("시간이 뒤로 가지 않음", monotonic);
    // after the 60 ms scheduling lead, song time should track wall time closely
    const tail = samples.filter((s) => s[1] > 0.1);
    let maxErr = 0;
    for (let i = 1; i < tail.length; i++) {
      const dWall = (tail[i][0] - tail[0][0]) / 1000, dSong = tail[i][1] - tail[0][1];
      maxErr = Math.max(maxErr, Math.abs(dWall - dSong));
    }
    check("실제 경과 시간과 오차 10ms 이내", tail.length > 5 && maxErr < 0.01, `최대 오차 ${(maxErr * 1000).toFixed(1)}ms`);
  }

  // ---------- 4. autoplay through the real game ----------
  async function loadGame() {
    const frame = document.getElementById("game");
    await new Promise((r) => { frame.onload = r; frame.src = "index.html?autotest=" + Date.now(); });
    const w = frame.contentWindow;
    await waitFor(() => w.SF && w.SF.game && w.document.body.dataset.screen === "setup", 5000);
    await sleep(1200); // let the app finish restoring its own library first
    return w;
  }

  async function autoplay(w, difficulty, missEvery) {
    const S = w.SF, st = S.state;
    st.difficulty = difficulty;
    st.audioFile = wavBlob(synthSong(128, 40));
    st.currentSongId = "__autoplay__";
    st.currentSongName = "AUTOPLAY TEST";
    st.phaseOffsetMs = 0;
    st.useCustomChart = false;
    w.document.getElementById("bpmInput").value = 128;
    S.game.startGame();
    if (!(await waitFor(() => st.running, 15000))) return { error: "게임이 시작되지 않음" };
    S.player.pause();
    const notes = st.notes.slice();
    const sync = st.syncOffsetMs;
    const events = [];
    let skipped = 0, taps = 0, holds = 0;
    notes.forEach((n, i) => {
      if (missEvery && i % missEvery === 0) { skipped++; return; }
      events.push({ t: n.time, lane: n.lane, press: true });
      if (n.hold) { holds++; events.push({ t: n.holdEnd + 5, lane: n.lane, press: false }); } else taps++;
    });
    const last = Math.max(...notes.map((n) => (n.hold ? n.holdEnd : n.time))) + 800;
    for (let t = 0; t < last; t += 40) events.push({ t, tick: true });
    events.sort((a, b) => a.t - b.t || (a.tick ? -1 : 1));
    let lastT = -1;
    for (const ev of events) {
      if (ev.t !== lastT) { S.player.seek((ev.t + sync) / 1000); S.game.frame(); lastT = ev.t; }
      if (ev.tick) continue;
      if (ev.press) { st.laneHeld[ev.lane] = true; S.game.handleHit(ev.lane); }
      else st.laneHeld[ev.lane] = false;
    }
    const snapshot = {
      notes: notes.length, taps, holds, skipped,
      counts: { ...st.counts }, score: st.score, maxCombo: st.maxCombo,
      max: S.MAX_SCORE[difficulty],
    };
    await S.game.finishGame();
    await sleep(1300);
    snapshot.screen = w.document.body.dataset.screen;
    snapshot.rScore = w.document.getElementById("rScore").textContent;
    snapshot.grade = w.document.getElementById("gradeLetter").textContent;
    await S.storage.idbDelete("scores:__autoplay__");
    return snapshot;
  }

  async function testAutoplay() {
    group("실제 게임 자동 플레이");
    let w;
    try { w = await loadGame(); } catch (e) { report("fail", "게임 페이지 로드", String(e)); return; }
    if (!w.SF || !w.SF.game) { report("fail", "게임 페이지 로드", "SF.game 없음"); return; }

    for (const d of ["normal", "hard"]) {
      const r = await autoplay(w, d, 0);
      if (r.error) { report("fail", `${d} 완벽 플레이`, r.error); continue; }
      const judgements = r.taps + r.holds * 2;
      check(`${d}: 모든 판정 PERFECT (${judgements}개, 홀드 ${r.holds}개)`, r.counts.perfect === judgements && r.counts.miss === 0 && r.counts.empty === 0, JSON.stringify(r.counts));
      check(`${d}: 점수가 최대치 ${r.max.toLocaleString()}`, r.score === r.max, r.score);
      check(`${d}: 최대 콤보 = 판정 수`, r.maxCombo === judgements, r.maxCombo);
      check(`${d}: 결과 화면 (점수 ${r.rScore}, 등급 ${r.grade})`, r.screen === "result" && r.rScore === r.max.toLocaleString() && r.grade === "SS", `${r.screen} ${r.rScore} ${r.grade}`);
    }

    const m = await autoplay(w, "normal", 7);
    if (m.error) report("fail", "일부러 놓치기", m.error);
    else {
      check(`놓친 노트 ${m.skipped}개가 정확히 MISS ${m.skipped}개로 집계`, m.counts.miss === m.skipped && m.counts.empty === 0, JSON.stringify(m.counts));
      check("놓친 판이 최대 점수보다 낮음", m.score < m.max, m.score);
    }

    // quitting during the countdown must not start the song
    const S = w.SF;
    S.ui.showScreen("setup");
    S.state.audioFile = wavBlob(synthSong(128, 10));
    S.state.currentSongId = "__autoplay__";
    S.game.startGame();
    await sleep(700);
    S.game.quit();
    await sleep(3200);
    check("카운트다운 중 그만두면 곡이 시작되지 않음", !S.state.running && !S.player.isPlaying());
  }

  async function runAll() {
    out.textContent = "";
    Object.assign(results, { pass: 0, fail: 0, skip: 0, done: false, failures: [] });
    summary.className = ""; summary.textContent = "실행 중…";
    try { testFeatures(); } catch (e) { report("fail", "음원 분석 테스트 오류", e.stack || String(e)); }
    try { testCharts(); } catch (e) { report("fail", "채보 테스트 오류", e.stack || String(e)); }
    try { await testClock(); } catch (e) { report("fail", "재생 시계 테스트 오류", e.stack || String(e)); }
    try { await testAutoplay(); } catch (e) { report("fail", "자동 플레이 테스트 오류", e.stack || String(e)); }
    results.done = true;
    summary.className = results.fail ? "bad" : "ok";
    summary.textContent = `${results.fail ? "실패 있음" : "모두 통과"} — 통과 ${results.pass} · 실패 ${results.fail} · 건너뜀 ${results.skip}`;
  }

  document.getElementById("runBtn").addEventListener("click", () => { SF.sfx.unlock(); runAll(); });
  runAll();
})();
