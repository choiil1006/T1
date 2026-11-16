// Song preview on the song select screen: plays the selected song's
// highlight (see audioAnalysis.findHighlight) with a fade in, loops it every
// PREVIEW_SEC with a fade out/in, and fades out when the selection changes
// or the screen is left.
//
// Uses a plain <audio> element streaming from the song's blob URL, so
// browsing the library never decodes whole songs into memory (the game's
// Web Audio player only loads a song once it's actually started).
(function () {
  "use strict";

  const VOLUME = 0.7;
  const FADE_IN = 0.8, FADE_OUT = 0.6, STOP_FADE = 0.25;

  let audio = null;      // the element currently playing (or starting)
  let current = null;    // {key, url, start} for `audio`
  let loopTimer = null;
  let blocked = null;    // a play() the browser refused (no user interaction yet), retried on the first tap/key

  function fade(a, target, sec, done) {
    clearInterval(a._fade);
    const from = a.volume, steps = Math.max(1, Math.round((sec * 1000) / 30));
    let i = 0;
    a._fade = setInterval(() => {
      i++;
      try { a.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps))); } catch (e) { /* volume is read-only on some mobile browsers */ }
      if (i >= steps) { clearInterval(a._fade); if (done) done(); }
    }, 30);
  }

  function release(a) {
    clearInterval(a._fade);
    a.pause();
    a.removeAttribute("src");
    a.load(); // drops the buffered data
    if (a._url) { URL.revokeObjectURL(a._url); a._url = null; }
  }

  function fadeOutAndRelease(a, sec) {
    if (a.paused) { release(a); return; }
    fade(a, 0, sec, () => release(a));
  }

  // start == null: highlight unknown (analysis failed) — begin ~30% in
  function startAt(a, start) {
    const dur = isFinite(a.duration) ? a.duration : 0;
    const at = start == null ? dur * 0.3 : start;
    try { a.currentTime = Math.max(0, dur ? Math.min(at, dur - 1) : at); } catch (e) { /* not seekable yet */ }
    try { a.volume = 0; } catch (e) { /* ignore */ }
    const p = a.play();
    const ok = () => {
      if (audio !== a) return;
      blocked = null;
      fade(a, VOLUME, FADE_IN);
      clearTimeout(loopTimer);
      loopTimer = setTimeout(() => {
        if (audio === a) fade(a, 0, FADE_OUT, () => { if (audio === a) startAt(a, start); });
      }, (SF.audioAnalysis.PREVIEW_SEC - FADE_OUT) * 1000);
    };
    if (p && p.then) p.then(ok).catch(() => { if (audio === a) blocked = { ...current }; });
    else ok();
  }

  // play song `blob` from `start` seconds; a no-op if that exact preview is
  // already on. The element gets its own object URL (revoked on release),
  // independent of the one the rest of the UI holds.
  function play(key, blob, start) {
    if (audio && current && current.key === key && current.start === start && !blocked) return;
    stop(STOP_FADE);
    const a = new Audio();
    a._url = URL.createObjectURL(blob);
    a.src = a._url;
    a.preload = "auto";
    audio = a;
    current = { key, blob, start };
    a.addEventListener("ended", () => { if (audio === a) startAt(a, start); });
    if (a.readyState >= 1) startAt(a, start);
    else a.addEventListener("loadedmetadata", () => { if (audio === a) startAt(a, start); }, { once: true });
  }

  function stop(fadeSec = STOP_FADE) {
    clearTimeout(loopTimer);
    blocked = null;
    if (audio) { const a = audio; audio = null; current = null; fadeOutAndRelease(a, fadeSec); }
  }

  function isPlaying() { return !!audio && !audio.paused; }

  // what's playing right now (for tests/debugging)
  function status() {
    return audio && current
      ? { key: current.key, start: current.start, time: audio.currentTime, volume: audio.volume, paused: audio.paused }
      : null;
  }

  // browsers refuse sound before the first interaction with the page — the
  // preview for the song restored on page load starts on the first tap/key.
  // Short delay: if that first tap selects a different song, the old one
  // never starts (selecting calls stop(), which clears `blocked`).
  ["pointerdown", "keydown"].forEach((ev) => window.addEventListener(ev, () => {
    if (!blocked) return;
    setTimeout(() => {
      if (!blocked || document.body.dataset.screen !== "setup") return;
      const b = blocked;
      blocked = null;
      current = null; // force a fresh start
      play(b.key, b.blob, b.start);
    }, 300);
  }, true));

  // don't keep playing in a background tab
  document.addEventListener("visibilitychange", () => {
    if (!audio) return;
    if (document.hidden) audio.pause();
    else if (document.body.dataset.screen === "setup") startAt(audio, current.start);
  });

  SF.preview = { play, stop, isPlaying, status };
})();
