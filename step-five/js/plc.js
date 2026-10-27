// PLC lights bridge. The browser cannot talk to the PLC directly, so it writes
// ONE byte to the Pico over Web Serial; the Pico turns the bits into GPIO
// outputs that reach the PLC inputs through an opto module:
//   bits 0-2 (X15, X16, X17) = score level 0..5  (0 = D ... 5 = SS grade)
//   bit  3   (X0)            = combo lamp on
// Web Serial needs Chromium on https:// or localhost, and the user must
// approve the port once. Everything here is optional: if no Pico is
// connected the game behaves exactly as before.
(function () {
  "use strict";

  const state = SF.state;
  const BAUD = 115200;
  const supported = "serial" in navigator;

  let port = null;
  let writer = null;
  let lastByte = -1;
  let busy = false;
  let pending = null;

  function statusEl() { return SF.$("plcStatus"); }
  function setStatus(text, ok) {
    const el = statusEl();
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("ok", !!ok);
  }

  function encode(level, combo) {
    return (Math.max(0, Math.min(5, level | 0)) & 7) | (combo ? 8 : 0);
  }

  // accuracy -> 0..5, using the same thresholds as the result screen grades
  function levelFor(accuracy, totalJudged) {
    if (!totalJudged) return 0;
    const t = SF.GRADE_THRESHOLDS;
    for (let i = 0; i < t.length; i++) if (accuracy >= t[i].min) return t.length - 1 - i;
    return 0;
  }

  async function flush() {
    if (busy || !writer || pending === null) return;
    busy = true;
    try {
      while (pending !== null) {
        const b = pending; pending = null;
        if (b === lastByte) continue;
        lastByte = b;
        await writer.write(new Uint8Array([b]));
      }
    } catch (err) {
      connectionLost();
    } finally { busy = false; }
  }

  function send(byte) { pending = byte; flush(); }

  async function openPort(p) {
    await p.open({ baudRate: BAUD });
    port = p;
    writer = p.writable.getWriter();
    lastByte = -1;
    send(0);
    setStatus("PLC 연결됨 (Pico)", true);
    updateButton();
  }

  function connectionLost() {
    writer = null; port = null; lastByte = -1; pending = null;
    setStatus("PLC 연결이 끊어졌습니다. 다시 연결하세요.", false);
    updateButton();
  }

  async function connect() {
    if (!supported) { setStatus("이 브라우저는 Web Serial을 지원하지 않습니다 (크롬을 쓰세요).", false); return; }
    try {
      const p = await navigator.serial.requestPort();
      await openPort(p);
    } catch (err) {
      if (err && err.name === "NotFoundError") setStatus("선택한 포트가 없습니다.", false);
      else setStatus("연결 실패: " + (err && err.message ? err.message : err), false);
    }
  }

  async function disconnect() {
    if (writer) {
      try { await writer.write(new Uint8Array([0])); } catch (e) { /* ignore */ }
      try { writer.releaseLock(); } catch (e) { /* ignore */ }
    }
    if (port) { try { await port.close(); } catch (e) { /* ignore */ } }
    writer = null; port = null; lastByte = -1; pending = null;
    setStatus("연결 안 됨", false);
    updateButton();
  }

  // reconnect to a port the user already approved earlier — no click needed
  async function autoConnect() {
    if (!supported) return;
    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length) await openPort(ports[0]);
    } catch (err) { /* the user can still connect by hand */ }
  }

  function updateButton() {
    const b = SF.$("plcConnectBtn");
    if (b) b.textContent = writer ? "연결 끊기" : "PLC 연결";
  }

  // --- called by the game ---
  function update(accuracy, totalJudged, combo) {
    const on = state.plcComboOn > 0 && combo >= state.plcComboOn;
    send(encode(levelFor(accuracy, totalJudged), on));
  }
  function showFinal(accuracy, totalJudged) { send(encode(levelFor(accuracy, totalJudged), false)); }
  function reset() { send(0); }

  function init() {
    if (!SF.$("plcConnectBtn")) return;
    if (!supported) setStatus("이 브라우저는 Web Serial을 지원하지 않습니다 (크롬 + https 또는 localhost).", false);
    SF.$("plcConnectBtn").addEventListener("click", () => { writer ? disconnect() : connect(); });
    const comboInput = SF.$("plcComboInput");
    comboInput.value = state.plcComboOn;
    comboInput.addEventListener("change", () => {
      const v = parseInt(comboInput.value, 10);
      state.plcComboOn = isFinite(v) ? Math.max(0, Math.min(9999, v)) : 30;
      comboInput.value = state.plcComboOn;
      SF.storage.persistGlobalSettings();
    });
    // bench test: step through every level and the combo bit
    document.querySelectorAll("[data-plc-test]").forEach((b) => {
      b.addEventListener("click", () => {
        const v = parseInt(b.dataset.plcTest, 10);
        if (v >= 0) send(v);
      });
    });
    if (navigator.serial) {
      navigator.serial.addEventListener("disconnect", connectionLost);
      autoConnect();
    }
  }

  SF.plc = { init, update, showFinal, reset, send, connect, disconnect, isConnected: () => !!writer };
})();
