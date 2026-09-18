// Procedural chart generation. When the song has been through the automatic
// BPM analyzer, its onset envelope is used to bias which grid steps get a
// note: strong beats are more likely to get one, quiet passages are more
// likely to be skipped, instead of every step rolling the same flat dice.
(function () {
  "use strict";

  function generateChart(bpm, difficulty, durationSec, phaseOffsetMs) {
    const diff = SF.DIFF[difficulty];
    const beatMs = 60000 / bpm;
    const stepMs = beatMs / diff.subdiv;
    const phase = ((phaseOffsetMs || 0) % beatMs + beatMs) % beatMs;
    const leadInMs = phase + beatMs * 4; // align to detected downbeat, then 4 beat lead-in
    const endMs = Math.max(0, durationSec * 1000 - beatMs * 2); // leave tail
    const notes = [];
    let lastLane = null;
    const laneBusyUntil = {}; SF.LANES.forEach((l) => (laneBusyUntil[l] = -Infinity));
    const holdChance = diff.holdChance != null ? diff.holdChance : 0.08;
    const hasOnsetData = !!SF.state.onset;

    for (let t = leadInMs; t < endMs; t += stepMs) {
      // base skip chance, pulled down on strong onsets and pushed up on quiet
      // ones when we actually have analysis data to lean on
      let skipChance = diff.skip;
      if (hasOnsetData) {
        const strength = SF.audioAnalysis.onsetStrengthAt(t); // 0..1
        skipChance = diff.skip * (1.5 - strength * 1.3); // strong beat -> as low as ~0.2x, quiet -> up to 1.5x
        skipChance = Math.max(0.03, Math.min(0.85, skipChance));
      }
      if (Math.random() < skipChance) continue; // rhythmic rest

      // how many lanes are currently mid-hold at this instant — never require
      // more than 2 lanes engaged at once (one held + at most one fresh tap/jump)
      const busyLanes = SF.LANES.filter((l) => laneBusyUntil[l] > t);
      if (busyLanes.length >= 2) continue; // already two hands/feet occupied, add nothing more
      const availableLanes = SF.LANES.filter((l) => !busyLanes.includes(l));
      if (availableLanes.length === 0) continue;

      let lane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
      if (lane === lastLane && availableLanes.length > 1 && Math.random() < 0.6) {
        const alt = availableLanes.filter((l) => l !== lane);
        lane = alt[Math.floor(Math.random() * alt.length)];
      }

      let isHold = Math.random() < holdChance;
      let holdEnd = null;
      if (isHold) {
        const holdSteps = 2 + Math.floor(Math.random() * 3); // 2~4 grid steps long
        holdEnd = t + holdSteps * stepMs;
        if (holdEnd > endMs) { isHold = false; holdEnd = null; }
      }

      if (isHold) {
        notes.push({ time: t, lane, hold: true, holdEnd, hit: false, judged: false, el: null, tailEl: null, holdState: null });
        laneBusyUntil[lane] = holdEnd + stepMs * 0.5;
      } else {
        notes.push({ time: t, lane, hold: false, hit: false, judged: false, el: null });
        // a 2-lane jump is only allowed when no hold is currently in force —
        // otherwise it would demand 3 simultaneous inputs (hold + 2 taps)
        if (busyLanes.length === 0 && Math.random() < diff.jump) {
          const jumpCandidates = availableLanes.filter((l) => l !== lane);
          if (jumpCandidates.length) {
            const lane2 = jumpCandidates[Math.floor(Math.random() * jumpCandidates.length)];
            notes.push({ time: t, lane: lane2, hold: false, hit: false, judged: false, el: null });
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
