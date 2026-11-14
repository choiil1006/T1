// Procedural chart generation, built around how a body actually moves on a
// 5-panel pad rather than dropping notes on random lanes.
//
// The pieces:
//
// 1) Feet. The generator tracks a left and a right foot. Left covers DL/UL,
//    right covers UR/DR, either can take CN. Steps alternate feet the way you
//    walk, a foot never lands on the panel the other foot is standing on, and
//    while one foot holds a long note every other note goes to the free foot.
//    That alone turns "notes on random lanes" into something you can dance.
// 2) Rhythm from the music. The song is analyzed (audio-analysis.js) into
//    onset strength for the whole mix, the low end (kick/bass) and the top
//    end (snare/hats). Each grid slot is kept or rested based on how much is
//    actually happening there, on-beats are favored over off-beats, busy
//    sections (choruses) get denser and can earn extra 16th notes, jumps land
//    on strong kicks, and holds go where the music leaves room after a hit.
// 3) Movement styles. Each 4-beat segment picks a style — free walking,
//    zigzag (each foot alternates its two panels), drill (each foot stays on
//    one panel: fast two-panel alternation) or center-heavy — weighted by
//    the section's energy, so streams read as recognizable shapes.
// 4) Repetition. Segments whose music matches (rhythm fingerprint of all
//    three bands + energy) reuse the same steps: the next segment of a
//    repeating groove plays it mirrored (left<->right), and a chorus that
//    comes back later gets the same steps as last time — so a chart can be
//    learned the way real charts are. A reused segment is re-checked against
//    the current foot position and falls back to fresh steps if it doesn't fit.
//
// Unchanged guarantees: the same song + difficulty recipe always gives the
// same chart (seeded PRNG; NORMAL and HARD share their recipe, so they get
// the identical chart on purpose), nothing in the last 3 seconds, no holds on
// CN, never more than two panels engaged at once, and a minimum time before
// the same panel is used again.
(function () {
  "use strict";

  const QUIET_TAIL_MS = 3000; // no notes in the last 3 seconds of the song
  const OTHER = { L: "R", R: "L" };
  const MIRROR = { DL: "DR", UL: "UR", CN: "CN", UR: "UL", DR: "DL" };
  const FOOT_LANES = { L: ["DL", "UL", "CN"], R: ["UR", "DR", "CN"] };
  const SIDE_LANES = { L: ["DL", "UL"], R: ["UR", "DR"] };

  // xfnv1a string hash -> mulberry32 PRNG. Deterministic: the same seed
  // string always produces the same sequence of "random" numbers.
  function makeSeededRandom(seedStr) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let state = h >>> 0;
    return function rand() {
      state |= 0; state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickWeighted(items, weights, rand) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let r = rand() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  // reading the analysis features (see audio-analysis.js computeFeatures)
  function makeReader(features) {
    if (!features || !features.full || !features.full.length) return null;
    const fps = features.fps;
    const full = features.full;
    const prefix = new Float64Array(full.length + 1);
    for (let i = 0; i < full.length; i++) prefix[i + 1] = prefix[i] + full[i];
    const frameOf = (ms) => Math.round((ms / 1000) * fps);
    return {
      // tallest value within ±halfMs — forgiving of small phase error
      peak(band, ms, halfMs) {
        const arr = features[band];
        const c = frameOf(ms), h = Math.max(1, Math.round((halfMs / 1000) * fps));
        let p = 0;
        for (let i = Math.max(0, c - h); i <= Math.min(arr.length - 1, c + h); i++) if (arr[i] > p) p = arr[i];
        return p;
      },
      // mean full-mix onset strength over a wide window (section busyness)
      avg(ms, winMs) {
        const h = Math.max(1, Math.round((winMs / 2 / 1000) * fps));
        const c = frameOf(ms);
        const a = Math.max(0, c - h), b = Math.min(full.length, c + h + 1);
        return b > a ? (prefix[b] - prefix[a]) / (b - a) : 0;
      },
    };
  }

  // time -> [0,1]: how energetic this part is relative to the song's own
  // range (0 = at/below its average, 1 = its busiest stretch)
  function sectionProfile(rd, durationMs) {
    const windowMs = 3500;
    const samples = [];
    for (let t = 0; t <= durationMs; t += 500) samples.push(rd.avg(t, windowMs));
    const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
    const max = samples.reduce((a, b) => Math.max(a, b), 0);
    const spread = Math.max(1e-6, max - mean);
    return (t) => Math.max(0, Math.min(1, (rd.avg(t, windowMs) - mean) / spread));
  }

  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
  }

  // ---- foot / panel state, with validation so reused segments can be
  //      checked before they're committed ----
  function makeBody() {
    const laneFreeAt = {}, laneLastT = {};
    SF.LANES.forEach((l) => { laneFreeAt[l] = -Infinity; laneLastT[l] = -Infinity; });
    return {
      pos: { L: null, R: null },            // panel each foot is resting on
      footFreeAt: { L: -Infinity, R: -Infinity }, // a holding foot is busy until its hold ends
      footLastT: { L: -Infinity, R: -Infinity },
      laneFreeAt,                            // cooldown / hold occupancy per panel
      laneLastT,
      lastFoot: null, lastT: -Infinity,
    };
  }
  function cloneBody(b) {
    return {
      pos: { ...b.pos }, footFreeAt: { ...b.footFreeAt }, footLastT: { ...b.footLastT },
      laneFreeAt: { ...b.laneFreeAt }, laneLastT: { ...b.laneLastT },
      lastFoot: b.lastFoot, lastT: b.lastT,
    };
  }
  function holdInForce(b, t) { return b.footFreeAt.L > t || b.footFreeAt.R > t; }

  function generateChart(bpm, difficulty, durationSec, phaseOffsetMs, songId, features) {
    const diff = SF.DIFF[difficulty];
    const beatMs = 60000 / bpm;
    const subdiv = diff.subdiv;
    const stepMs = beatMs / subdiv;
    const phase = (((phaseOffsetMs || 0) % beatMs) + beatMs) % beatMs;
    const leadInMs = phase + beatMs * 4; // align to detected downbeat, then 4 beat lead-in
    const durationMs = durationSec * 1000;
    // nothing (taps, hold heads or hold releases) lands in the last stretch
    // of the song, so it finishes on a clear 3 seconds instead of a note
    const endMs = Math.max(0, durationMs - QUIET_TAIL_MS);
    const holdBase = diff.holdChance != null ? diff.holdChance : 0.08;
    const isEasy = difficulty === "easy";

    const seedKey = "v2|" + (songId || "nosong") + "|" + subdiv + "|" + diff.skip + "|" + diff.jump + "|" + holdBase;
    const rand = makeSeededRandom(seedKey);
    const rd = makeReader(features);
    const energyAt = rd ? sectionProfile(rd, durationMs) : () => 0.5;

    const minSameLaneGapMs = stepMs * 1.3;
    const postHoldRecoveryMs = stepMs * 2.5;
    const segMs = beatMs * 4;
    const slotsPerSeg = 4 * subdiv;

    // ---- 1) read every 4-beat segment of the music ----
    const segs = [];
    for (let s = leadInMs; s < endMs; s += segMs) {
      const slots = [];
      for (let i = 0; i < slotsPerSeg; i++) {
        const t = s + i * stepMs;
        if (t >= endMs) break;
        slots.push({
          t, onBeat: i % subdiv === 0,
          full: rd ? rd.peak("full", t, stepMs * 0.35) : 0.5,
          low: rd ? rd.peak("low", t, stepMs * 0.35) : 0.5,
          high: rd ? rd.peak("high", t, stepMs * 0.35) : 0.5,
        });
      }
      const vec = [];
      slots.forEach((sl) => vec.push(sl.full, sl.low, sl.high));
      segs.push({ start: s, slots, energy: energyAt(s + segMs / 2), vec, copy: null, steps: null });
    }

    // ---- 2) which segments repeat earlier music ----
    // Limits keep a song built on one unchanging loop from collapsing into
    // the same two bars for four minutes: a pattern can come back as a
    // reprise at most twice, and at most 8 segments (32 beats — a typical
    // chorus) in a row are reused before fresh steps are forced.
    const MAX_REPRISES = 2, MAX_REUSE_RUN = 8;
    if (rd) {
      let run = 0;
      for (let k = 1; k < segs.length; k++) {
        const seg = segs[k];
        if (seg.slots.length !== slotsPerSeg || run >= MAX_REUSE_RUN ||
            seg.vec.reduce((a, v) => a + v, 0) < 0.4) { run = 0; continue; } // near-silent: nothing to recognize
        let best = null, bestCos = 0.92;
        for (let j = 0; j < k; j++) {
          const prev = segs[j];
          const pair = j === k - 1 && !prev.copy;   // A A' — the next bar of a groove
          const reprise = k - j >= 4;               // a section coming back later
          if (!pair && !reprise) continue;
          const root = segs[prev.copy ? prev.copy.from : j];
          if (!pair && (root.reprises || 0) >= MAX_REPRISES) continue;
          if (prev.slots.length !== slotsPerSeg || Math.abs(prev.energy - seg.energy) > 0.25) continue;
          const c = cosine(seg.vec, prev.vec);
          if (c > bestCos || (pair && c >= bestCos && best && !best.pair)) { bestCos = c; best = { j, pair }; }
        }
        if (best) {
          const prev = segs[best.j];
          const rootIdx = prev.copy ? prev.copy.from : best.j;
          const prevMirror = prev.copy ? prev.copy.mirror : false;
          seg.copy = { from: rootIdx, mirror: best.pair ? !prevMirror : prevMirror };
          if (!best.pair) segs[rootIdx].reprises = (segs[rootIdx].reprises || 0) + 1;
          run++;
        } else run = 0;
      }
    }

    // ---- 3) place steps ----
    const notes = [];
    let body = makeBody();

    function laneOpen(b, lane, t) { return b.laneFreeAt[lane] <= t; }
    function footOpen(b, foot, t) {
      if (b.footFreeAt[foot] > t) return false;
      // the same foot twice in a row needs a moment — more while the other foot is pinned by a hold
      const minGap = holdInForce(b, t) ? stepMs * 2 : stepMs * 0.9;
      return t - b.footLastT[foot] >= minGap;
    }

    // validate + apply one step to body `b`; returns the note objects, or null if it doesn't fit
    function tryStep(b, st, t) {
      if (t >= endMs) return null;
      if (st.kind === "jump") {
        if (holdInForce(b, t) || st.lane === st.lane2) return null;
        if (!laneOpen(b, st.lane, t) || !laneOpen(b, st.lane2, t)) return null;
        if (!footOpen(b, "L", t) || !footOpen(b, "R", t)) return null;
        b.pos.L = st.lane; b.pos.R = st.lane2;
        b.footLastT.L = b.footLastT.R = t;
        b.laneFreeAt[st.lane] = b.laneFreeAt[st.lane2] = t + minSameLaneGapMs;
        b.laneLastT[st.lane] = b.laneLastT[st.lane2] = t;
        b.lastFoot = null; b.lastT = t;
        return [
          { time: t, lane: st.lane, hold: false, hit: false, judged: false, el: null },
          { time: t, lane: st.lane2, hold: false, hit: false, judged: false, el: null },
        ];
      }
      const foot = st.foot, lane = st.lane;
      if (!FOOT_LANES[foot].includes(lane)) return null;
      if (!laneOpen(b, lane, t) || !footOpen(b, foot, t)) return null;
      if (b.pos[OTHER[foot]] === lane) return null; // the other foot is standing there
      if (st.kind === "hold") {
        const holdEnd = t + st.holdLen;
        if (lane === "CN" || holdEnd > endMs || holdInForce(b, t)) return null;
        b.pos[foot] = lane;
        b.footFreeAt[foot] = holdEnd + stepMs;
        b.footLastT[foot] = holdEnd;
        b.laneFreeAt[lane] = holdEnd + postHoldRecoveryMs;
        b.laneLastT[lane] = holdEnd;
        b.lastFoot = foot; b.lastT = t;
        return [{ time: t, lane, hold: true, holdEnd, hit: false, judged: false, el: null, tailEl: null, holdState: null }];
      }
      b.pos[foot] = lane;
      b.footLastT[foot] = t;
      b.laneFreeAt[lane] = t + minSameLaneGapMs;
      b.laneLastT[lane] = t;
      b.lastFoot = foot; b.lastT = t;
      return [{ time: t, lane, hold: false, hit: false, judged: false, el: null }];
    }

    function chooseStyle(energy) {
      const r = rand();
      if (isEasy) return r < 0.7 ? "free" : r < 0.85 ? "zigzag" : "center";
      if (energy > 0.6) return r < 0.3 ? "drill" : r < 0.6 ? "zigzag" : "free";
      if (energy > 0.3) return r < 0.6 ? "free" : r < 0.85 ? "zigzag" : "center";
      return r < 0.7 ? "free" : "center";
    }

    function pickLane(foot, t, style, drill) {
      const cands = FOOT_LANES[foot].filter((l) => laneOpen(body, l, t) && body.pos[OTHER[foot]] !== l);
      if (!cands.length) return null;
      const weights = cands.map((l) => {
        if (style === "drill" && l === drill[foot]) return 6;
        if (style === "zigzag" && l !== body.pos[foot] && l !== "CN") return 4;
        let w = l === body.pos[foot] ? (t - body.laneLastT[l] >= beatMs ? 0.5 : 0.15) : 1;
        if (l === "CN") w *= style === "center" ? 1.8 : 0.55;
        return w;
      });
      return pickWeighted(cands, weights, rand);
    }

    function pickJump(t) {
      const pairs = [];
      const weights = [];
      SIDE_LANES.L.forEach((a) => SIDE_LANES.R.forEach((b) => {
        if (!laneOpen(body, a, t) || !laneOpen(body, b, t)) return;
        pairs.push([a, b]);
        weights.push(MIRROR[a] === b ? 1 : 0.45); // symmetric jumps (DL+DR, UL+UR) feel most natural
      }));
      return pairs.length ? pickWeighted(pairs, weights, rand) : null;
    }

    function freshSegment(seg) {
      const style = chooseStyle(seg.energy);
      const drill = { L: rand() < 0.5 ? "UL" : "DL", R: rand() < 0.5 ? "UR" : "DR" };
      const steps = [];

      // rhythm: which slots get a step
      const events = [];
      seg.slots.forEach((sl) => {
        let skip = diff.skip;
        if (rd) {
          skip = Math.max(0.03, Math.min(0.85, diff.skip * (1.5 - sl.full * 1.3)));
          skip = Math.max(0.03, Math.min(0.9, skip * (1.35 - seg.energy * 0.7)));
        }
        skip = Math.min(0.95, skip * (sl.onBeat ? 0.85 : 1.2));
        if (rand() < skip) return; // rhythmic rest
        events.push({ t: sl.t, onBeat: sl.onBeat, low: sl.low, bonus: false });
        // energetic sections can earn a 16th between grid steps where a real onset backs it up
        if (!isEasy && rd) {
          const midT = sl.t + stepMs / 2;
          const midEnergy = energyAt(midT);
          const midPeak = rd.peak("full", midT, stepMs * 0.3);
          const bonusChance = Math.max(0, midEnergy - 0.55) * 0.5 * midPeak;
          if (midT < endMs && rand() < bonusChance) events.push({ t: midT, onBeat: false, low: 0, bonus: true });
        }
      });

      events.forEach((ev, idx) => {
        const t = ev.t;
        const nextT = idx + 1 < events.length ? events[idx + 1].t : seg.start + segMs;

        // jumps: on strong on-beat kicks, never during a hold
        if (!isEasy && ev.onBeat && !holdInForce(body, t)) {
          const jc = diff.jump * (0.6 + seg.energy * 1.2) * (rd ? (ev.low > 0.5 ? 1.8 : 0.5) : 1);
          if (rand() < jc) {
            const pair = pickJump(t);
            if (pair) {
              const st = { kind: "jump", lane: pair[0], lane2: pair[1] };
              const placed = tryStep(body, st, t);
              if (placed) { notes.push(...placed); steps.push({ dt: t - seg.start, ...st }); return; }
            }
          }
        }

        // which foot: alternate like walking; after a long rest either foot may lead
        let foot = (body.lastFoot == null || t - body.lastT > beatMs * 2)
          ? (rand() < 0.5 ? "L" : "R")
          : OTHER[body.lastFoot];
        if (!footOpen(body, foot, t)) foot = OTHER[foot];
        if (!footOpen(body, foot, t)) return;

        const lane = pickLane(foot, t, style, drill);
        if (!lane) return;

        // holds: where the music leaves room after the hit, more in calm sections
        let st = { kind: "tap", foot, lane };
        if (lane !== "CN" && !holdInForce(body, t)) {
          const roomy = nextT - t >= stepMs * 2;
          const hc = holdBase * (1.3 - seg.energy * 0.6) * (roomy ? 1.35 : 0.6);
          if (rand() < hc) {
            const holdSteps = 2 + Math.floor(rand() * 3); // 2~4 grid steps long
            st = { kind: "hold", foot, lane, holdLen: holdSteps * stepMs };
          }
        }
        let placed = tryStep(body, st, t);
        if (!placed && st.kind === "hold") { st = { kind: "tap", foot, lane }; placed = tryStep(body, st, t); }
        if (placed) { notes.push(...placed); steps.push({ dt: t - seg.start, ...st }); }
      });
      seg.steps = steps;
    }

    // re-play an earlier segment's steps (optionally mirrored) if they fit
    // the current foot position; all-or-nothing
    function reuseSegment(seg, src, mirror) {
      const trial = cloneBody(body);
      const out = [];
      const steps = [];
      for (const s0 of src.steps) {
        const s = mirror
          ? (s0.kind === "jump"
            ? { ...s0, lane: MIRROR[s0.lane2], lane2: MIRROR[s0.lane] }
            : { ...s0, foot: OTHER[s0.foot], lane: MIRROR[s0.lane] })
          : s0;
        const placed = tryStep(trial, s, seg.start + s.dt);
        if (!placed) return false;
        out.push(...placed);
        steps.push(s);
      }
      body = trial;
      notes.push(...out);
      seg.steps = steps;
      return true;
    }

    segs.forEach((seg) => {
      if (seg.copy) {
        const src = segs[seg.copy.from];
        if (src.steps && src.steps.length &&
            (reuseSegment(seg, src, seg.copy.mirror) || reuseSegment(seg, src, !seg.copy.mirror))) return;
      }
      freshSegment(seg);
    });

    notes.sort((a, b) => a.time - b.time || SF.LANES.indexOf(a.lane) - SF.LANES.indexOf(b.lane));
    return notes;
  }

  SF.chartGenerator = { generateChart, QUIET_TAIL_MS };
})();
