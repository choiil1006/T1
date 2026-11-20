// Shared namespace + constants for STEP FIVE.
// Loaded first: every other file attaches to window.SF.
window.SF = window.SF || {};

SF.LANES = ["DL", "UL", "CN", "UR", "DR"];

// subdiv: grid steps per beat (0.5 = one step every 2 beats). minGapMs: on
// fast songs the grid is coarsened until steps are at least this far apart.
// simple: beginner-friendly movement styles, no extra 16th notes.
// approach: ms a note takes to fall to the judge line. windows: ± ms.
SF.DIFF = {
  easy:   { subdiv: 0.5, minGapMs: 600, simple: true, approach: 1800, windows: { perfect: 180, great: 300, good: 420, bad: 560 }, skip: 0.10, jump: 0.0,  holdChance: 0.03, label: "EASY" },
  normal: { subdiv: 1,                  simple: true, approach: 1400, windows: { perfect: 150, great: 260, good: 380, bad: 520 }, skip: 0.15, jump: 0.0,  holdChance: 0.05, label: "NORMAL" },
  hard:   { subdiv: 2,                                approach: 1100, windows: { perfect: 100, great: 190, good: 280, bad: 380 }, skip: 0.30, jump: 0.08, holdChance: 0.09, label: "HARD" },
};

SF.JUDGE_SCORE = { perfect: 100, great: 70, good: 35, bad: 10, miss: -20 };
// held together for this long during play = pause (a chord charts never
// ask for: they never need more than two panels at once)
SF.PAD_PAUSE_LANES = ["UL", "UR", "CN"];
SF.PAD_PAUSE_HOLD_MS = 1000;
SF.PAD_QUIT_HOLD_MS = 1000; // on the pause screen: hold ↖ or ↗ to quit
// the score a flawless run (every judgement PERFECT, never broken combo) ends
// on — scores are scaled so this is the ceiling for that difficulty, which
// makes harder difficulties able to reach a higher top score on any song
SF.MAX_SCORE = { easy: 500000, normal: 750000, hard: 1000000 };
// bump whenever generated charts change, so old best records (set on a
// different chart) are cleared — see storage.resetScoresIfChartChanged
SF.CHART_VERSION = 3;
SF.GRADE_THRESHOLDS = [
  { min: 98, grade: "SS" },
  { min: 94, grade: "S" },
  { min: 88, grade: "A" },
  { min: 75, grade: "B" },
  { min: 60, grade: "C" },
  { min: 0,  grade: "D" },
];

SF.$ = (id) => document.getElementById(id);
