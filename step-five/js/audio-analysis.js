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

  // RMS loudness per ~10 ms frame
  function energyEnvelope(data, sr) {
    const hop = Math.round(sr / FPS);
    const frames = Math.floor(data.length / hop);
    const energy = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      const start = i * hop, end = Math.min(start + hop, data.length);
      for (let j = start; j < end; j++) { const v = data[j]; sum += v * v; }
      energy[i] = Math.sqrt(sum / hop);
    }
    return energy;
  }

  function fullBandOnset(data, sr) {
    return onsetFromEnergy(energyEnvelope(data, sr));
  }

  const PREVIEW_SEC = 15;

  // Where the song's highlight (usually the chorus) starts, in seconds: the
  // loudest/busiest PREVIEW_SEC stretch, pulled back to where that loud part
  // begins, then snapped to a bar line so the preview starts on the beat.
  // The intro (first 10%) and the very end are skipped.
  function findHighlight(energy, onset, fps, durationSec, bpm, phaseMs) {
    if (durationSec < PREVIEW_SEC + 10) return 0;
    const blockSec = 0.5, per = Math.max(1, Math.round(fps * blockSec));
    const nb = Math.floor(energy.length / per);
    const blocks = new Float64Array(nb);
    for (let b = 0; b < nb; b++) {
      let e = 0, o = 0;
      for (let i = b * per; i < (b + 1) * per; i++) { e += energy[i]; o += onset[i]; }
      blocks[b] = e / per + (o / per) * 4; // loud AND busy beats loud-but-flat
    }
    const prefix = new Float64Array(nb + 1);
    for (let b = 0; b < nb; b++) prefix[b + 1] = prefix[b] + blocks[b];
    const w = Math.round(PREVIEW_SEC / blockSec);
    const lo = Math.floor((durationSec * 0.1) / blockSec);
    const hi = Math.floor((durationSec - PREVIEW_SEC - 3) / blockSec);
    if (hi <= lo) return Math.max(0, Math.min(durationSec * 0.3, durationSec - PREVIEW_SEC));
    let best = lo, bestSum = -1;
    for (let s = lo; s <= hi; s++) {
      const sum = prefix[s + w] - prefix[s];
      if (sum > bestSum) { bestSum = sum; best = s; }
    }
    // the loudest window often starts mid-chorus: back up (up to 8 s) while
    // the music is still about as loud, to catch the start of that section
    const thr = 0.8 * (bestSum / w);
    let s = best;
    while (s > lo && s > best - 16 && blocks[s - 1] >= thr) s--;
    let startSec = s * blockSec;
    if (bpm > 0) {
      const bar = (4 * 60) / bpm, ph = (phaseMs || 0) / 1000;
      startSec = ph + Math.round((startSec - ph) / bar) * bar;
    }
    return Math.round(Math.max(0, Math.min(durationSec - PREVIEW_SEC, startSec)) * 100) / 100;
  }

  // Decoding for analysis goes through an OfflineAudioContext: it never
  // touches the sound card, so it works even where the audio output is
  // missing or misconfigured (a common state on a Raspberry Pi) and needs
  // no user interaction. A real-time context is only the fallback.
  const ANALYSIS_RATE = 44100;
  async function decodeAudio(file) {
    const data = await file.arrayBuffer();
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (OAC) {
      try { return await new OAC(1, 1, ANALYSIS_RATE).decodeAudioData(data.slice(0)); }
      catch (err) { if (err && err.name === "EncodingError") throw err; /* else try the real-time path */ }
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    try { return await ac.decodeAudioData(data); } finally { ac.close(); }
  }

  async function decodeMono(file) {
    const audioBuffer = await decodeAudio(file);
    return { data: mixToMono(audioBuffer), sr: audioBuffer.sampleRate, duration: audioBuffer.duration };
  }

  // decode failures that are about the FILE (unreadable data) vs. about the
  // browser/device (out of memory, audio system unavailable…) — the second
  // kind must not be reported as "your MP3 is broken"
  function isFileProblem(err) {
    return !!err && (err.name === "EncodingError" || /decode|unable to decode/i.test(err.message || ""));
  }

  // highlight only, for songs analyzed before highlights existed
  async function analyzeHighlight(file, bpm, phaseMs) {
    const { data, sr, duration } = await decodeMono(file);
    const fps = sr / Math.round(sr / FPS);
    const energy = energyEnvelope(data, sr);
    return findHighlight(energy, onsetFromEnergy(energy), fps, duration, bpm, phaseMs);
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
    const { data, sr, duration } = await decodeMono(file);

    // 1-2) onset strength (positive rise of the ~100 fps energy envelope)
    const fps = sr / Math.round(sr / FPS); // exactly 100 at 44.1/48 kHz
    const energy = energyEnvelope(data, sr);
    const onset = onsetFromEnergy(energy);
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

    const highlightSec = findHighlight(energy, onset, fps, duration, bpm, phaseMs);
    return { bpm, phaseMs, highlightSec, durationSec: duration };
  }

  // a short, human reason why `file` couldn't be decoded, from what its
  // bytes actually are (the extension often lies: downloaders save web
  // pages or other formats under ".mp3")
  async function describeUnreadable(file) {
    if (!file.size) return "빈 파일이에요 (0바이트). 다시 다운로드해 주세요.";
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const ascii = String.fromCharCode(...head).toLowerCase();
    const at = (i, ...bytes) => bytes.every((b, k) => head[i + k] === b);
    if (/^\s*(<!doctype|<html|<head|<\?xml|\{)/.test(ascii)) return "음악이 아니라 웹페이지/텍스트 파일이에요. 다운로드가 제대로 안 된 것 같아요 — 다시 받아 주세요.";
    if (at(4, 0x66, 0x74, 0x79, 0x70)) return "이름은 MP3지만 실제로는 M4A/MP4 파일인데, 이 브라우저가 해당 코덱을 지원하지 않아요. Chrome에서 열거나 MP3로 변환해 주세요.";
    if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "실제로는 WebM/MKV 파일인데 이 브라우저에서 해독하지 못했어요. MP3로 변환해 주세요.";
    if (at(0, 0x4f, 0x67, 0x67, 0x53)) return "실제로는 OGG 파일인데 이 브라우저에서 해독하지 못했어요. MP3로 변환해 주세요.";
    if (at(0, 0x30, 0x26, 0xb2, 0x75)) return "실제로는 WMA 파일이에요 — 브라우저가 지원하지 않는 형식이라 MP3로 변환해 주세요.";
    if (at(0, 0x49, 0x44, 0x33) || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
      return file.size < 100 * 1024
        ? "MP3지만 너무 작아요 — 다운로드가 중간에 끊긴 것 같아요."
        : "MP3 파일이지만 손상됐거나 일부가 잘려 있어요. 다시 받아 주세요.";
    }
    return "지원하지 않는 형식이거나 손상된 파일이에요. MP3로 변환해 주세요.";
  }

  SF.audioAnalysis = { analyzeBPM, describeUnreadable, isFileProblem, decodeAudio, analyzeHighlight, findHighlight, computeFeatures, PREVIEW_SEC };
})();
