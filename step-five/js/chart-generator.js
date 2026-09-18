// Procedural chart generation.
//
// Three things this file is responsible for, beyond just placing notes on a
// beat grid:
//
// 1) Reproducibility — chart generation is seeded from the song + the
//    difficulty's actual generation "recipe" (not its name), so replaying a
//    song always gives back the same chart. NORMAL and HARD intentionally
//    share identical skip/jump/hold parameters (see constants.js — HARD is
//    "the same chart, just a stricter judge"), so keying the seed off those
//    parameters rather than the difficulty name makes them produce the
//    exact same note sequence, preserving that design on purpose.
// 2) Section-aware density — a smoothed, song-relative read of "how busy is
//    this part of the song" (computeSectionProfile) drives more than a flat
//    per-step dice roll: quieter sections thin out further, energetic ones
//    lean into more jumps, and — on NORMAL/HARD — genuinely busier sections
//    can earn an extra off-grid note where a real onset peak supports it,
//    instead of just being "less likely to skip" on the same fixed grid.
// 3) Physically sensible patterns — lane selection favors nearby lanes over
//    big stretches across the pad (pickLaneByFlow), and a minimum recovery
//    time before the same lane can be used again scales with the
//    difficulty's own judgement window, so fast songs don't demand
//    impossible same-lane double-taps.
(function () {
  "use strict";

  const LANE_INDEX = { DL: 0, UL: 1, CN: 2, UR: 3, DR: 4 };

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

  // a function of time -> [0,1] describing how energetic this moment is
  // *relative to this song's own dynamic range* (0 = at or below the song's
  // average busyness, 1 = as busy as the song's peak) — a verse/chorus-scale
  // read, built from wide-window averages, not single-beat onset strength
  function computeSectionProfile(durationMs) {
    const sampleStepMs = 500;
    const windowMs = 3500;
    const samples = [];
    for (let t = 0; t <= durationMs; t += sampleStepMs) {
      samples.push(SF.audioAnalysis.onsetWindowAvg(t, windowMs));
    }
    const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
    const max = samples.reduce((a, b) => Math.max(a, b), 0);
    const spread = Math.max(1e-6, max - mean);
    return function sectionEnergyAt(t) {
      const raw = SF.audioAnalysis.onsetWindowAvg(t, windowMs);
      return Math.max(0, Math.min(1, (raw - mean) / spread));
    };
  }

  // pick among candidateLanes, favoring ones physically close to fromLane
  // (natural foot/hand movement) over big stretches across the pad, without
  // ever fully excluding a repeat or a stretch — just making them rarer
  function pickLaneByFlow(candidateLanes, fromLane, rand) {
    if (fromLane == null || candidateLanes.length === 1) {
      return candidateLanes[Math.floor(rand() * candidateLanes.length)];
    }
    const fromIdx = LANE_INDEX[fromLane];
    const weights = candidateLanes.map((l) => {
      const dist = Math.abs(LANE_INDEX[l] - fromIdx);
      if (dist === 0) return 0.35;
      if (dist === 1) return 1.0;
      if (dist === 2) return 0.55;
      if (dist === 3) return 0.3;
      return 0.15;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (let i = 0; i < candidateLanes.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidateLanes[i];
    }
    return candidateLanes[candidateLanes.length - 1];
  }

  function generateChart(bpm, difficulty, durationSec, phaseOffsetMs, songId) {
    const diff = SF.DIFF[difficulty];
    const beatMs = 60000 / bpm;
    const stepMs = beatMs / diff.subdiv;
    const phase = ((phaseOffsetMs || 0) % beatMs + beatMs) % beatMs;
    const leadInMs = phase + beatMs * 4; // align to detected downbeat, then 4 beat lead-in
    const durationMs = durationSec * 1000;
    const endMs = Math.max(0, durationMs - beatMs * 2); // leave tail
    const notes = [];
    let lastLane = null;
    const holdChanceBase = diff.holdChance != null ? diff.holdChance : 0.08;
    const hasOnsetData = !!SF.state.onset;

    const seedKey = (songId || "nosong") + "|" + diff.subdiv + "|" + diff.skip + "|" + diff.jump + "|" + holdChanceBase;
    const rand = makeSeededRandom(seedKey);

    const sectionEnergyAt = hasOnsetData ? computeSectionProfile(durationMs) : null;

    // laneBusyUntil: a hold is physically occupying that hand/foot right
    // now — this is what the "never more than 2 lanes engaged" rule counts.
    // laneCooldownUntil: just "don't reuse this lane again too soon" — a
    // pacing rule, not an occupancy one, so it must NOT count toward that
    // same 2-lane cap (otherwise frequent short cooldowns from ordinary taps
    // would make many steps look "busy" and starve the chart of notes).
    const laneBusyUntil = {};
    const laneCooldownUntil = {};
    SF.LANES.forEach((l) => { laneBusyUntil[l] = -Infinity; laneCooldownUntil[l] = -Infinity; });

    // deliberately built from stepMs (shared by NORMAL/HARD) alone, not from
    // diff.windows — that differs between NORMAL and HARD, and pulling it in
    // here would make their otherwise-identical chart recipe diverge
    const minSameLaneGapMs = stepMs * 1.3;
    const postHoldRecoveryMs = stepMs * 2.5;

    for (let t = leadInMs; t < endMs; t += stepMs) {
      // base skip chance, pulled down on strong onsets and pushed up on quiet
      // ones when we actually have analysis data to lean on. Uses the
      // strongest onset in a small neighborhood of this grid slot rather
      // than a single instant, since a real beat rarely lands exactly on
      // the quantized sample.
      let skipChance = diff.skip;
      if (hasOnsetData) {
        const strength = SF.audioAnalysis.onsetPeakNear(t, stepMs * 0.35);
        skipChance = diff.skip * (1.5 - strength * 1.3);
        skipChance = Math.max(0.03, Math.min(0.85, skipChance));
      }
      let energy = 0.5;
      if (sectionEnergyAt) {
        energy = sectionEnergyAt(t);
        // on top of the per-beat check above: quiet sections thin out
        // further, energetic ones (choruses) hold back less
        skipChance *= (1.35 - energy * 0.7);
        skipChance = Math.max(0.03, Math.min(0.9, skipChance));
      }
      if (rand() < skipChance) continue; // rhythmic rest

      // how many lanes are currently mid-hold at this instant — never require
      // more than 2 lanes engaged at once (one held + at most one fresh tap/jump)
      const busyLanes = SF.LANES.filter((l) => laneBusyUntil[l] > t);
      if (busyLanes.length >= 2) continue; // already two hands/feet occupied, add nothing more
      const availableLanes = SF.LANES.filter((l) => !busyLanes.includes(l) && laneCooldownUntil[l] <= t);
      if (availableLanes.length === 0) continue;

      const lane = pickLaneByFlow(availableLanes, lastLane, rand);

      let jumpChance = diff.jump;
      let holdChance = holdChanceBase;
      if (sectionEnergyAt) {
        jumpChance *= (0.6 + energy * 1.2); // busier sections -> more jumps
        holdChance *= (1.3 - energy * 0.6); // calmer sections favor holds a bit more
      }

      let isHold = rand() < holdChance;
      let holdEnd = null;
      if (isHold) {
        const holdSteps = 2 + Math.floor(rand() * 3); // 2~4 grid steps long
        holdEnd = t + holdSteps * stepMs;
        if (holdEnd > endMs) { isHold = false; holdEnd = null; }
      }

      if (isHold) {
        notes.push({ time: t, lane, hold: true, holdEnd, hit: false, judged: false, el: null, tailEl: null, holdState: null });
        laneBusyUntil[lane] = holdEnd + postHoldRecoveryMs;
        laneCooldownUntil[lane] = holdEnd + postHoldRecoveryMs;
      } else {
        notes.push({ time: t, lane, hold: false, hit: false, judged: false, el: null });
        laneCooldownUntil[lane] = t + minSameLaneGapMs;
        // a 2-lane jump is only allowed when no hold is currently in force —
        // otherwise it would demand 3 simultaneous inputs (hold + 2 taps)
        if (busyLanes.length === 0 && rand() < jumpChance) {
          const jumpCandidates = availableLanes.filter((l) => l !== lane && laneCooldownUntil[l] <= t);
          if (jumpCandidates.length) {
            const lane2 = pickLaneByFlow(jumpCandidates, lane, rand);
            notes.push({ time: t, lane: lane2, hold: false, hit: false, judged: false, el: null });
            laneCooldownUntil[lane2] = t + minSameLaneGapMs;
          }
        }

        // a bonus off-grid note partway to the next step, only on
        // NORMAL/HARD and only where a real onset peak backs it up — this
        // is what gives energetic sections genuinely denser patterns
        // instead of just a lower chance of resting
        if (difficulty !== "easy" && sectionEnergyAt) {
          const midT = t + stepMs / 2;
          if (midT < endMs) {
            const midEnergy = sectionEnergyAt(midT);
            const midPeak = SF.audioAnalysis.onsetPeakNear(midT, stepMs * 0.3);
            const bonusChance = Math.max(0, midEnergy - 0.55) * 0.5 * midPeak;
            const midBusy = SF.LANES.filter((l) => laneBusyUntil[l] > midT);
            const midAvailable = SF.LANES.filter((l) => !midBusy.includes(l) && laneCooldownUntil[l] <= midT);
            if (midAvailable.length && rand() < bonusChance) {
              const bonusLane = pickLaneByFlow(midAvailable, lane, rand);
              notes.push({ time: midT, lane: bonusLane, hold: false, hit: false, judged: false, el: null });
              laneCooldownUntil[bonusLane] = midT + minSameLaneGapMs;
            }
          }
        }
      }
      lastLane = lane;
    }
    notes.sort((a, b) => a.time - b.time);
    return notes;
  }

  SF.chartGenerator = { generateChart };
})();
