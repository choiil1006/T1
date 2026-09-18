// Shared namespace + constants for STEP FIVE.
// Loaded first: every other file attaches to window.SF.
window.SF = window.SF || {};

SF.LANES = ["DL", "UL", "CN", "UR", "DR"];

SF.DIFF = {
  easy:   { subdiv: 1, approach: 1400, windows: { perfect: 150, great: 260, good: 380, bad: 520 }, skip: 0.15, jump: 0.0,  holdChance: 0.05, label: "EASY" },
  normal: { subdiv: 2, approach: 1100, windows: { perfect: 100, great: 190, good: 280, bad: 380 }, skip: 0.30, jump: 0.08, holdChance: 0.09, label: "NORMAL" },
  hard:   { subdiv: 2, approach: 1100, windows: { perfect: 40,  great: 80,  good: 130, bad: 190 }, skip: 0.30, jump: 0.08, holdChance: 0.09, label: "HARD" },
};

SF.JUDGE_SCORE = { perfect: 100, great: 70, good: 35, bad: 10, miss: -20 };
SF.EMPTY_PRESS_PENALTY = 15;
SF.GRADE_THRESHOLDS = [
  { min: 98, grade: "SS" },
  { min: 94, grade: "S" },
  { min: 88, grade: "A" },
  { min: 75, grade: "B" },
  { min: 60, grade: "C" },
  { min: 0,  grade: "D" },
];

SF.$ = (id) => document.getElementById(id);
