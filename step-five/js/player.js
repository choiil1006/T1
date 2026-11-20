// Song playback on the Web Audio clock.
//
// The game used to judge against an <audio> element's currentTime, which
// several browsers only update in coarse chunks (tens of ms), so identical
// presses could land on different judgements and notes could stutter. Here
// the whole song is decoded into an AudioBuffer and the song position is
// read from the AudioContext's output timestamp, interpolated with
// performance.now() — smooth, sub-millisecond, and it reflects what is
// actually coming out of the speakers.
//
// Memory: only ONE decoded song is ever held. Loading a different song drops
// the previous buffer first (a 4-minute song is ~80-90 MB decoded), so the
// library size doesn't matter — dozens of songs stay compressed in storage.
(function () {
  "use strict";

  let buffer = null, bufferKey = null, features = null;
  let loadToken = 0;
  let source = null, gain = null;
  let playing = false;
  let startedAt = 0;   // context time at which song position 0 is/was heard
  let pausedAt = 0;    // song position (s) while not playing
  let lastTime = 0;    // keeps the clock from stepping backwards between timestamp updates
  let onEnded = null;

  function ctx() { return SF.sfx.context(); }

  // decodes (or reuses, if it's the same song) and analyzes the song.
  // Resolves to {buffer, features}, or null if a newer load replaced it.
  async function load(key, blob) {
    const token = ++loadToken;
    if (buffer && bufferKey === key) return { buffer, features };
    stop();
    buffer = null; bufferKey = null; features = null; // release the old song before decoding the new one
    const data = await blob.arrayBuffer();
    const decoded = await ctx().decodeAudioData(data);
    if (token !== loadToken) return null;
    const feats = SF.audioAnalysis.computeFeatures(decoded);
    if (token !== loadToken) return null;
    buffer = decoded; bufferKey = key; features = feats;
    return { buffer, features };
  }

  function stopSource() {
    if (!source) return;
    const s = source;
    source = null; // onended of a deliberately stopped source is ignored (see play)
    try { s.stop(); } catch (e) { /* already stopped */ }
    s.disconnect();
  }

  function play(fromSec = 0, endedCb) {
    if (!buffer) return;
    if (endedCb !== undefined) onEnded = endedCb;
    stopSource();
    const c = ctx();
    if (!gain) { gain = c.createGain(); gain.connect(c.destination); }
    const s = c.createBufferSource();
    s.buffer = buffer;
    s.connect(gain);
    const when = c.currentTime + 0.06; // tiny lead so the start is sample-accurate
    s.start(when, Math.max(0, fromSec));
    startedAt = when - fromSec;
    lastTime = fromSec - 0.06;
    source = s;
    playing = true;
    s.onended = () => {
      if (source !== s) return;
      source = null; playing = false; pausedAt = buffer ? buffer.duration : 0;
      if (onEnded) onEnded();
    };
  }

  // context time of the sample reaching the speakers right now
  function outputNow() {
    const c = ctx();
    if (c.getOutputTimestamp) {
      const ts = c.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
    }
    return c.currentTime - (c.outputLatency || c.baseLatency || 0);
  }

  // current song position in seconds (may be slightly negative right at the start)
  function time() {
    if (!playing) return pausedAt;
    let t = outputNow() - startedAt;
    if (t < lastTime && lastTime - t < 0.05) t = lastTime; // smooth over timestamp refresh jitter
    lastTime = t;
    return t;
  }

  function pause() {
    if (!playing) return;
    pausedAt = Math.max(0, time());
    playing = false;
    stopSource();
  }

  function resume() {
    if (playing || !buffer) return;
    play(pausedAt);
  }

  function stop() {
    playing = false;
    pausedAt = 0;
    stopSource();
  }

  // position the song while paused (used by the automated tests)
  function seek(sec) {
    if (playing) { play(sec); return; }
    pausedAt = sec;
  }

  function duration() { return buffer ? buffer.duration : 0; }
  function isPlaying() { return playing; }

  SF.player = { load, play, pause, resume, stop, seek, time, duration, isPlaying };
})();
