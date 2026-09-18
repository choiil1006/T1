// Tiny synthesized sound effects (no audio assets needed) for hit/miss
// feedback. Uses its own AudioContext, independent of song playback.
(function () {
  "use strict";

  let ctx = null;
  let enabled = true;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function blip({ freq, duration, type = "sine", gain = 0.18, slideTo = null }) {
    if (!enabled) return;
    const ac = ensureCtx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), ac.currentTime + duration);
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    osc.connect(g).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + duration + 0.02);
  }

  const JUDGE_SFX = {
    perfect: () => blip({ freq: 1200, duration: 0.09, type: "triangle", gain: 0.16 }),
    great:   () => blip({ freq: 900,  duration: 0.09, type: "triangle", gain: 0.14 }),
    good:    () => blip({ freq: 650,  duration: 0.08, type: "sine",     gain: 0.12 }),
    bad:     () => blip({ freq: 420,  duration: 0.08, type: "sine",     gain: 0.10 }),
    miss:    () => blip({ freq: 220,  duration: 0.16, type: "sawtooth", gain: 0.10, slideTo: 90 }),
  };

  function playJudge(grade) {
    const fn = JUDGE_SFX[grade];
    if (fn) fn();
  }

  function playEditorTick() {
    blip({ freq: 1500, duration: 0.04, type: "square", gain: 0.08 });
  }

  function setEnabled(v) { enabled = !!v; }
  function isEnabled() { return enabled; }
  function unlock() { ensureCtx(); } // call from a user gesture to satisfy autoplay policies

  SF.sfx = { playJudge, playEditorTick, setEnabled, isEnabled, unlock };
})();
