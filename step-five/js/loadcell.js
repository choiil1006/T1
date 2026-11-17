// Load cell tools on the settings screen: re-zero (tare), live per-pad
// readings, and per-pad press/release thresholds.
//
// The pads' load cells are read by the pad controller board (HX711s on a
// microcontroller that types keys over USB), not by the game, so all of this
// goes through that board's USB serial port (Web Serial — Chrome/Edge on PC
// and Raspberry Pi, over https or localhost). Line-based protocol at 115200
// baud, pads always in game order DL UL CN UR DR (index 0-4); full spec in
// hardware/loadcell-serial-protocol.md:
//   TARE              -> OK TARE
//   STREAM 1 / 0      -> OK STREAM 1|0, then (while on) "V v0 v1 v2 v3 v4 P bbbbb" ~25/s
//   TH?               -> TH on0 off0 on1 off1 ... on4 off4
//   TH i on off       -> OK TH i on off   (saved on the board)
(function () {
  "use strict";

  const BAUD = 115200;
  const COUNTDOWN_SEC = 3;
  const DEFAULT_ON = 65000, DEFAULT_OFF = 45000;
  const BAR_MAX = 150000; // full width of a live bar
  const LANE_ICON = { DL: "↙", UL: "↖", CN: "⊙", UR: "↗", DR: "↘" };
  const supported = typeof navigator !== "undefined" && "serial" in navigator;

  let port = null;          // chosen board (stays chosen across page loads)
  let conn = null;          // {writer, reader, lines:Set<fn>} while the port is open
  let busy = false;
  let streaming = false;
  let thresholds = SF.LANES.map(() => ({ on: DEFAULT_ON, off: DEFAULT_OFF }));
  let onSettings = false;

  const $ = (id) => SF.$(id);

  function describe(p) {
    const info = p && p.getInfo ? p.getInfo() : {};
    const hex = (n) => (n == null ? "?" : n.toString(16).padStart(4, "0").toUpperCase());
    return info.usbVendorId != null ? `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}` : "시리얼 장치";
  }

  function setStatus(text, kind) {
    const el = $("lcStatus");
    el.textContent = text;
    el.classList.toggle("ok", kind === "ok");
    el.classList.toggle("err", kind === "err");
  }

  function refreshButtons() {
    $("lcConnectBtn").disabled = !supported || busy;
    $("lcTareBtn").disabled = !supported || busy || !port;
    $("lcSaveBtn").disabled = !supported || busy || !port;
    $("lcPresetBtn").disabled = busy;
  }

  // ---------- connection ----------
  let opening = null;
  async function open() {
    if (conn) return conn;
    if (opening) return opening;
    opening = openNow();
    try { return await opening; } finally { opening = null; }
  }

  async function openNow() {
    if (!port) throw new Error("보드가 연결되지 않았어요");
    await port.open({ baudRate: BAUD });
    const writer = port.writable.getWriter();
    const reader = port.readable.getReader();
    const c = { writer, reader, lines: new Set() };
    conn = c;
    (async () => {
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.search(/\r?\n/)) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(buf[nl] === "\r" ? nl + 2 : nl + 1);
            if (line) c.lines.forEach((fn) => fn(line));
          }
          if (buf.length > 4096) buf = buf.slice(-256);
        }
      } catch (e) { /* port lost */ }
    })();
    return c;
  }

  async function close() {
    const c = conn;
    if (!c) return;
    conn = null;
    streaming = false;
    try { await c.reader.cancel(); } catch (e) { /* already closed */ }
    try { c.reader.releaseLock(); } catch (e) { /* ignore */ }
    try { c.writer.releaseLock(); } catch (e) { /* ignore */ }
    try { await port.close(); } catch (e) { /* ignore */ }
  }

  // send one line; resolve with the first reply line matching `expect`, or null on timeout
  async function command(text, expect, timeoutMs = 2000) {
    const c = await open();
    return new Promise((resolve) => {
      let timer;
      const onLine = (line) => { if (expect.test(line)) { cleanup(); resolve(line); } };
      const cleanup = () => { clearTimeout(timer); c.lines.delete(onLine); };
      c.lines.add(onLine);
      timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
      c.writer.write(new TextEncoder().encode(text + "\n")).catch(() => { cleanup(); resolve(null); });
    });
  }

  // ---------- live view ----------
  function buildMonitor() {
    const box = $("lcMonitor");
    box.textContent = "";
    SF.LANES.forEach((lane, i) => {
      const row = document.createElement("div");
      row.className = "lcPad";
      row.dataset.lane = lane;
      row.innerHTML =
        `<span class="lcName">${LANE_ICON[lane]} ${lane}</span>` +
        `<div class="lcBar"><i class="lcFill"></i><b class="lcOff"></b><b class="lcOn"></b></div>` +
        `<span class="lcVal">—</span>` +
        `<label>ON <input type="number" class="lcOnIn" step="1000" min="0"></label>` +
        `<label>OFF <input type="number" class="lcOffIn" step="1000" min="0"></label>`;
      row.querySelector(".lcOnIn").addEventListener("change", (e) => { thresholds[i].on = +e.target.value || 0; drawThresholds(); });
      row.querySelector(".lcOffIn").addEventListener("change", (e) => { thresholds[i].off = +e.target.value || 0; drawThresholds(); });
      box.appendChild(row);
    });
    drawThresholds();
  }

  function pct(v) { return Math.max(0, Math.min(100, (v / BAR_MAX) * 100)); }

  function drawThresholds() {
    document.querySelectorAll("#lcMonitor .lcPad").forEach((row, i) => {
      const t = thresholds[i];
      row.querySelector(".lcOnIn").value = t.on;
      row.querySelector(".lcOffIn").value = t.off;
      row.querySelector(".lcOn").style.left = pct(t.on) + "%";
      row.querySelector(".lcOff").style.left = pct(t.off) + "%";
      row.classList.toggle("bad", !(t.on > t.off && t.off >= 0));
    });
  }

  function showReading(values, pressed) {
    document.querySelectorAll("#lcMonitor .lcPad").forEach((row, i) => {
      const v = values[i];
      row.querySelector(".lcFill").style.transform = `scaleX(${pct(v) / 100})`;
      row.querySelector(".lcVal").textContent = Math.round(v).toLocaleString();
      row.classList.toggle("pressed", pressed ? pressed[i] === "1" : v >= thresholds[i].on);
    });
  }

  function onStreamLine(line) {
    const m = line.match(/^V\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)(?:\s+P\s+([01]{5}))?/);
    if (m) showReading(m.slice(1, 6).map(Number), m[6]);
  }

  let starting = false;
  async function startLive() {
    if (!port || streaming || busy || starting) return;
    starting = true;
    try {
      const c = await open();
      c.lines.add(onStreamLine);
      const th = await command("TH?", /^TH\s/, 1500);
      if (th) {
        const nums = th.split(/\s+/).slice(1).map(Number);
        if (nums.length >= 10) thresholds = SF.LANES.map((_, i) => ({ on: nums[i * 2], off: nums[i * 2 + 1] }));
        drawThresholds();
      }
      const ok = await command("STREAM 1", /^OK STREAM/, 1500);
      streaming = !!ok;
      $("lcMonitor").classList.toggle("live", streaming);
      if (!th && !ok) setStatus(`연결됨 — ${describe(port)} · 이 보드 펌웨어는 실시간 값/기준값 명령을 지원하지 않아요 (영점만 사용 가능할 수 있어요)`, "err");
      else setStatus(`연결됨 — ${describe(port)} · 실시간 값 표시 중`, "ok");
    } catch (err) {
      setStatus("보드를 열 수 없어요: " + (err && err.message ? err.message : err), "err");
      await close();
    } finally {
      starting = false;
    }
    if (!onSettings) stopLive(); // left the screen while it was starting
  }

  async function stopLive() {
    if (conn && streaming) { try { await command("STREAM 0", /^OK STREAM/, 800); } catch (e) { /* ignore */ } }
    $("lcMonitor").classList.remove("live");
    await close();
  }

  // ---------- actions ----------
  async function connect() {
    try {
      port = await navigator.serial.requestPort(); // the browser's own device picker
      setStatus(`연결됨 — ${describe(port)}`, "ok");
      refreshButtons();
      if (onSettings) startLive();
    } catch (err) {
      if (err && err.name === "NotFoundError") return; // picker closed without choosing
      setStatus("보드를 연결하지 못했어요: " + (err && err.message ? err.message : err), "err");
    }
    refreshButtons();
  }

  async function tare() {
    if (!port || busy) return;
    busy = true;
    refreshButtons();
    const btn = $("lcTareBtn");
    try {
      for (let s = COUNTDOWN_SEC; s > 0; s--) { // time to step off the pads
        btn.textContent = `${s}초 뒤 영점… 발을 내려주세요`;
        await new Promise((r) => setTimeout(r, 1000));
      }
      btn.textContent = "영점 잡는 중…";
      const ok = await command("TARE", /OK\s*TARE/i, 4000);
      if (ok) {
        setStatus(`영점을 다시 잡았어요 (${new Date().toLocaleTimeString()})`, "ok");
        SF.ui.showToast("로드셀 영점을 다시 잡았어요.");
      } else {
        setStatus("보드에서 응답이 없어요 — 펌웨어가 TARE 명령을 지원하는지 확인해 주세요.", "err");
      }
    } catch (err) {
      setStatus("영점 재설정 실패: " + (err && err.message ? err.message : err), "err");
    } finally {
      btn.textContent = "영점 재설정";
      busy = false;
      refreshButtons();
      if (!onSettings) close();
    }
  }

  async function saveThresholds() {
    const bad = thresholds.findIndex((t) => !(t.on > t.off && t.off >= 0));
    if (bad >= 0) { SF.ui.showToast(`${SF.LANES[bad]}: ON 값이 OFF 값보다 커야 해요.`, { type: "error" }); return; }
    busy = true;
    refreshButtons();
    try {
      let saved = 0;
      for (let i = 0; i < thresholds.length; i++) {
        const t = thresholds[i];
        if (await command(`TH ${i} ${Math.round(t.on)} ${Math.round(t.off)}`, new RegExp(`^OK TH ${i}\\b`), 1500)) saved++;
      }
      if (saved === thresholds.length) SF.ui.showToast("기준값을 보드에 저장했어요.");
      else setStatus(`기준값 저장 응답이 ${saved}/5칸만 왔어요 — 펌웨어가 TH 명령을 지원하는지 확인해 주세요.`, "err");
    } catch (err) {
      setStatus("기준값 저장 실패: " + (err && err.message ? err.message : err), "err");
    } finally {
      busy = false;
      refreshButtons();
    }
  }

  function preset() {
    thresholds = SF.LANES.map(() => ({ on: DEFAULT_ON, off: DEFAULT_OFF }));
    drawThresholds();
  }

  // live readings only while the settings screen is open (the port is
  // released during play)
  function screenChanged(name) {
    onSettings = name === "settings";
    if (!supported) return;
    if (onSettings) startLive(); else if (!busy) stopLive();
  }

  async function init() {
    buildMonitor();
    if (!supported) {
      setStatus("이 브라우저는 USB 시리얼을 지원하지 않아요. PC나 라즈베리파이의 Chrome/Edge에서 사용해 주세요.", "err");
      refreshButtons();
      return;
    }
    $("lcConnectBtn").addEventListener("click", connect);
    $("lcTareBtn").addEventListener("click", tare);
    $("lcSaveBtn").addEventListener("click", saveThresholds);
    $("lcPresetBtn").addEventListener("click", preset);
    navigator.serial.addEventListener("disconnect", (e) => {
      if (e.target === port) { conn = null; streaming = false; port = null; $("lcMonitor").classList.remove("live"); setStatus("보드 연결이 끊겼어요.", "err"); refreshButtons(); }
    });
    navigator.serial.addEventListener("connect", async () => {
      if (port) return;
      const ports = await navigator.serial.getPorts();
      if (ports.length) { port = ports[0]; setStatus(`연결됨 — ${describe(port)}`, "ok"); refreshButtons(); if (onSettings) startLive(); }
    });
    try {
      const ports = await navigator.serial.getPorts(); // a board allowed once before is remembered
      if (ports.length) { port = ports[0]; setStatus(`연결됨 — ${describe(port)}`, "ok"); }
      else setStatus("발판 보드가 연결되지 않았어요. '보드 연결'을 눌러 선택해 주세요.");
    } catch (err) { setStatus("시리얼 장치를 확인할 수 없어요.", "err"); }
    refreshButtons();
  }

  // tests swap in a simulated board
  function _usePort(p) { port = p; refreshButtons(); }
  function _thresholds() { return thresholds.map((t) => ({ ...t })); }

  SF.loadcell = { init, supported, screenChanged, _usePort, _thresholds, DEFAULT_ON, DEFAULT_OFF };
})();
