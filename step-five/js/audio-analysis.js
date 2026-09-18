// Automatic BPM + phase detection from the uploaded audio file itself (via
// onset autocorrelation), run automatically whenever a song is selected. It
// also hands back the onset envelope, which chart-generator.js uses to bias
// note placement toward the song's real beats.
(function () {
  "use strict";

  function mixToMono(buffer) {
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    const ch0 = buffer.getChannelData(0), ch1 = buffer.getChannelData(1);
    const out = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) out[i] = (ch0[i] + ch1[i]) * 0.5;
    return out;
  }

  async function analyzeBPM(file) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ac.decodeAudioData(arrayBuffer);
    const data = mixToMono(audioBuffer);
    const sr = audioBuffer.sampleRate;

    // 1) energy envelope at ~100 fps
    const fps = 100;
    const hop = Math.round(sr / fps);
    const frames = Math.floor(data.length / hop);
    const energy = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      const start = i * hop, end = Math.min(start + hop, data.length);
      for (let j = start; j < end; j++) { const v = data[j]; sum += v * v; }
      energy[i] = Math.sqrt(sum / hop);
    }
    // 2) onset strength = positive energy rise
    const onset = new Float32Array(frames);
    let onsetMax = 0;
    for (let i = 1; i < frames; i++) {
      onset[i] = Math.max(0, energy[i] - energy[i - 1]);
      if (onset[i] > onsetMax) onsetMax = onset[i];
    }

    // 3) autocorrelation over plausible tempo range (60-200 BPM), weighted by
    //    a tempo prior to avoid octave errors. Plain unweighted autocorrelation
    //    routinely locks onto a harmonic of the true beat period — usually
    //    double the true period (half the real tempo) — because a lot of
    //    music accents every OTHER beat more strongly (e.g. kick on 1 & 3,
    //    snare on 2 & 4), so "strong beat vs strong beat" two beats apart can
    //    score higher than "beat vs beat" one beat apart. Weighting each
    //    lag's score by how close it is (in log2/octave terms) to a typical
    //    song tempo breaks that tie in favor of the musically normal answer,
    //    same technique real tempo estimators use. Also normalize the raw sum
    //    by how many terms went into it, so longer lags (fewer terms) aren't
    //    unfairly penalized relative to shorter ones.
    const minBPM = 60, maxBPM = 200;
    const minLag = Math.max(1, Math.round(fps * 60 / maxBPM));
    const maxLag = Math.min(frames - 1, Math.round(fps * 60 / minBPM));
    function acScore(lag) {
      let sum = 0;
      const n = frames - lag;
      for (let i = lag; i < frames; i++) sum += onset[i] * onset[i - lag];
      return n > 0 ? sum / n : 0;
    }
    function tempoPriorWeight(candidateBpm) {
      // broad log-normal prior centered on 120 BPM (~0.6 octave std dev) —
      // wide enough to not hard-exclude anything, just tips close calls
      const octavesFromCenter = Math.log2(candidateBpm / 120);
      return Math.exp(-0.5 * (octavesFromCenter / 0.6) ** 2);
    }
    let bestLag = minLag, bestWeightedScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const weighted = acScore(lag) * tempoPriorWeight(60 * fps / lag);
      if (weighted > bestWeightedScore) { bestWeightedScore = weighted; bestLag = lag; }
    }
    const bpm = Math.round(60 * fps / bestLag);

    // 4) phase: find the offset (within one beat) that best lines up with onsets
    let bestPhase = 0, bestPhaseScore = -Infinity;
    for (let phase = 0; phase < bestLag; phase++) {
      let score = 0;
      for (let i = phase; i < frames; i += bestLag) { score += onset[i]; }
      if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = phase; }
    }
    const phaseMs = (bestPhase / fps) * 1000;

    ac.close();
    return { bpm, phaseMs, onset: { envelope: onset, fps, max: onsetMax || 1 } };
  }

  // strength in [0,1] of the song's onset envelope near time `ms`; 0.5 (flat)
  // if no analysis has been run for the current audio.
  function onsetStrengthAt(ms) {
    const o = SF.state.onset;
    if (!o) return 0.5;
    const idx = Math.round((ms / 1000) * o.fps);
    if (idx < 0 || idx >= o.envelope.length) return 0;
    return Math.min(1, o.envelope[idx] / o.max);
  }

  SF.audioAnalysis = { analyzeBPM, onsetStrengthAt };
})();
