// Automatic BPM + phase detection from the uploaded audio file itself (via
// onset autocorrelation), run automatically whenever a song is selected, plus
// the per-band onset features chart-generator.js builds charts from
// (computed from the decoded song each time it's played — see player.js).
(function () {
  "use strict";

  function mixToMono(buffer) {
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    const ch0 = buffer.getChannelData(0), ch1 = buffer.getChannelData(1);
    const out = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) out[i] = (ch0[i] + ch1[i]) * 0.5;
    return out;
  }

  const FPS = 100;

  // RMS energy per frame (FPS frames/sec) -> onset strength = positive rise
  function onsetFromEnergy(energy) {
    const onset = new Float32Array(energy.length);
    for (let i = 1; i < energy.length; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
    return onset;
  }

  function fullBandOnset(data, sr) {
    const hop = Math.round(sr / FPS);
    const frames = Math.floor(data.length / hop);
    const energy = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      const start = i * hop, end = Math.min(start + hop, data.length);
      for (let j = start; j < end; j++) { const v = data[j]; sum += v * v; }
      energy[i] = Math.sqrt(sum / hop);
    }
    return onsetFromEnergy(energy);
  }

  // scale to [0,1] by a high percentile rather than the single loudest
  // frame, so one spike doesn't flatten the rest of the song
  function normalize(arr) {
    const sorted = Array.from(arr).filter((v) => v > 0).sort((a, b) => a - b);
    const ref = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 1;
    const out = new Float32Array(arr.length);
    const k = 1 / Math.max(1e-9, ref);
    for (let i = 0; i < arr.length; i++) out[i] = Math.min(1, arr[i] * k);
    return out;
  }

  // what the chart generator reads: onset strength for the whole mix, the
  // low end (kick/bass, < ~150 Hz) and the top end (snare/hats, > ~3 kHz),
  // each [0,1] at FPS frames per second. Low/high come from cheap one-pole
  // filters — plenty to tell "a kick hit" from "a hi-hat tick".
  function computeFeatures(audioBuffer) {
    const data = mixToMono(audioBuffer);
    const sr = audioBuffer.sampleRate;
    const hop = Math.round(sr / FPS);
    const frames = Math.floor(data.length / hop);
    const aLow = 1 - Math.exp(-2 * Math.PI * 150 / sr);
    const aHigh = 1 - Math.exp(-2 * Math.PI * 3000 / sr);
    const eLow = new Float32Array(frames), eHigh = new Float32Array(frames);
    let lp1 = 0, lp2 = 0, lpH = 0;
    for (let i = 0; i < frames; i++) {
      let sL = 0, sH = 0;
      const start = i * hop, end = start + hop;
      for (let j = start; j < end; j++) {
        const x = data[j];
        lp1 += aLow * (x - lp1);
        lp2 += aLow * (lp1 - lp2);
        lpH += aHigh * (x - lpH);
        const h = x - lpH;
        sL += lp2 * lp2; sH += h * h;
      }
      eLow[i] = Math.sqrt(sL / hop);
      eHigh[i] = Math.sqrt(sH / hop);
    }
    return {
      fps: sr / hop, // exact frame rate (hop is rounded, e.g. 221 samples at 22.05 kHz)
      full: normalize(fullBandOnset(data, sr)),
      low: normalize(onsetFromEnergy(eLow)),
      high: normalize(onsetFromEnergy(eHigh)),
    };
  }

  async function analyzeBPM(file) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ac.decodeAudioData(arrayBuffer);
    ac.close();
    const data = mixToMono(audioBuffer);
    const sr = audioBuffer.sampleRate;

    // 1-2) onset strength (positive rise of the ~100 fps energy envelope)
    const fps = sr / Math.round(sr / FPS); // exactly 100 at 44.1/48 kHz
    const onset = fullBandOnset(data, sr);
    const frames = onset.length;

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

    return { bpm, phaseMs };
  }

  SF.audioAnalysis = { analyzeBPM, computeFeatures };
})();
