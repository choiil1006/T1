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

    // 3) autocorrelation over plausible tempo range (60-200 BPM)
    const minBPM = 60, maxBPM = 200;
    const minLag = Math.max(1, Math.round(fps * 60 / maxBPM));
    const maxLag = Math.min(frames - 1, Math.round(fps * 60 / minBPM));
    let bestLag = minLag, bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let score = 0;
      for (let i = lag; i < frames; i++) { score += onset[i] * onset[i - lag]; }
      if (score > bestScore) { bestScore = score; bestLag = lag; }
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
