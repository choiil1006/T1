// Central mutable state for the whole game. Every module reads/writes SF.state.
(function () {
  "use strict";

  SF.state = {
    audioURL: null, audioFile: null, audioEl: null, bpm: 120, difficulty: "normal",
    phaseOffsetMs: 0, currentSongId: null,
    songAnalyzed: false, // has automatic BPM/onset analysis already run for the current song?

    // signed ms: how far the perceived beat lags the audio element's reported
    // currentTime (positive = your speakers/headphones are late). Judge time
    // is corrected by subtracting this, so hits land right instead of always
    // reading as early or late for a given setup.
    syncOffsetMs: 0,

    mapping: { // default keyboard mapping via numpad geometry
      DL: { type: "key", code: "Numpad1", label: "Num1" },
      UL: { type: "key", code: "Numpad7", label: "Num7" },
      CN: { type: "key", code: "Numpad5", label: "Num5" },
      UR: { type: "key", code: "Numpad9", label: "Num9" },
      DR: { type: "key", code: "Numpad3", label: "Num3" },
    },
    listeningLane: null,

    notes: [], // {time, lane, hit, judged, el}
    score: 0, combo: 0, maxCombo: 0,
    counts: { perfect: 0, great: 0, good: 0, bad: 0, miss: 0, empty: 0 },
    totalJudged: 0,
    running: false, paused: false,
    rafId: null,
    gpPrevPressed: {}, // "gamepadIndex_buttonIndex" -> bool
    useCustomChart: false,
    customChart: null,
    edRecording: false,
    laneHeld: { DL: false, UL: false, CN: false, UR: false, DR: false },

    // populated only after "파일 분석으로 자동 측정" runs; lets chart
    // generation bias note density toward the song's real onsets instead of
    // being fully random. Not persisted — it's cheap to recompute.
    onset: null, // {envelope:Float32Array, fps:number, max:number}
  };

  SF.screens = {}; // filled in by ui.js once the DOM is ready
})();
