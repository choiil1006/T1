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

  function later(ms, fn) { setTimeout(fn, ms); }

  // menu sounds: moving through songs, switching difficulty, confirming,
  // going back, and the combo-milestone fanfare in game
  const MENU_SFX = {
    move:   () => blip({ freq: 880,  duration: 0.045, type: "triangle", gain: 0.09 }),
    diff:   () => blip({ freq: 1320, duration: 0.05,  type: "square",   gain: 0.05 }),
    select: () => { blip({ freq: 660, duration: 0.07, type: "square", gain: 0.06 });
                    later(70, () => blip({ freq: 1320, duration: 0.14, type: "square", gain: 0.06 })); },
    back:   () => blip({ freq: 620,  duration: 0.12, type: "triangle", gain: 0.09, slideTo: 360 }),
    milestone: () => [784, 988, 1175, 1568].forEach((f, i) =>
                    later(i * 55, () => blip({ freq: f, duration: 0.12, type: "triangle", gain: 0.08 }))),
  };

  function playMenu(kind) {
    const fn = MENU_SFX[kind];
    if (fn) fn();
  }

  function setEnabled(v) { enabled = !!v; }
  function isEnabled() { return enabled; }
  function unlock() { ensureCtx(); } // call from a user gesture to satisfy autoplay policies

  // any key/tap/click resumes a suspended context, so a session started
  // from a gamepad-only press still gets sound once anything is touched
  ["pointerdown", "keydown"].forEach((ev) =>
    window.addEventListener(ev, () => { if (ctx && ctx.state === "suspended") ctx.resume(); }, true));

  // the song player (player.js) shares this context, so music and hit
  // sounds run on one clock and one output
  SF.sfx = { playJudge, playEditorTick, playMenu, setEnabled, isEnabled, unlock, context: ensureCtx };
})();
