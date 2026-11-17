// Load cell zero (tare) from the settings screen.
//
// The pads' load cells are read by the pad controller board (HX711s on a
// microcontroller that types keys over USB), not by the game. To re-zero
// them the game talks to that board over its USB serial port (Web Serial —
// Chrome/Edge on PC and Raspberry Pi, over https or localhost) and sends one
// line; the board's firmware must answer it. Protocol (see
// hardware/loadcell-serial-protocol.md):
//   game  -> board : "TARE\n"     (115200 baud)
//   board -> game  : "OK TARE\n"  once every pad has been re-zeroed
(function () {
  "use strict";

  const BAUD = 115200;
  const REPLY_TIMEOUT_MS = 4000;
  const COUNTDOWN_SEC = 3;
  const supported = typeof navigator !== "undefined" && "serial" in navigator;

  let port = null;
  let busy = false;

  function $(id) { return SF.$(id); }

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
  }

  async function connect() {
    try {
      port = await navigator.serial.requestPort(); // the browser's own device picker
      setStatus(`연결됨 — ${describe(port)}`, "ok");
    } catch (err) {
      if (err && err.name === "NotFoundError") return; // picker closed without choosing
      setStatus("보드를 연결하지 못했어요: " + (err && err.message ? err.message : err), "err");
    }
    refreshButtons();
  }

  // send TARE and wait for "OK TARE"; resolves true/false
  async function sendTare(p) {
    await p.open({ baudRate: BAUD });
    let ok = false;
    try {
      const writer = p.writable.getWriter();
      await writer.write(new TextEncoder().encode("TARE\n"));
      writer.releaseLock();
      const reader = p.readable.getReader();
      const timer = setTimeout(() => reader.cancel().catch(() => {}), REPLY_TIMEOUT_MS);
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          if (/OK\s*TARE/i.test(buf)) { ok = true; break; }
          if (buf.length > 4096) buf = buf.slice(-256); // the board may also be printing other things
        }
      } finally {
        clearTimeout(timer);
        try { await reader.cancel(); } catch (e) { /* already closed */ }
        reader.releaseLock();
      }
    } finally {
      await p.close();
    }
    return ok;
  }

  async function tare() {
    if (!port || busy) return;
    busy = true;
    refreshButtons();
    const btn = $("lcTareBtn");
    try {
      // time to step off the pads
      for (let s = COUNTDOWN_SEC; s > 0; s--) {
        btn.textContent = `${s}초 뒤 영점… 발을 내려주세요`;
        await new Promise((r) => setTimeout(r, 1000));
      }
      btn.textContent = "영점 잡는 중…";
      const ok = await sendTare(port);
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
    }
  }

  async function init() {
    if (!supported) {
      setStatus("이 브라우저는 USB 시리얼을 지원하지 않아요. PC나 라즈베리파이의 Chrome/Edge에서 사용해 주세요.", "err");
      refreshButtons();
      return;
    }
    $("lcConnectBtn").addEventListener("click", connect);
    $("lcTareBtn").addEventListener("click", tare);
    navigator.serial.addEventListener("disconnect", (e) => {
      if (e.target === port) { port = null; setStatus("보드 연결이 끊겼어요.", "err"); refreshButtons(); }
    });
    navigator.serial.addEventListener("connect", async () => {
      if (port) return;
      const ports = await navigator.serial.getPorts();
      if (ports.length) { port = ports[0]; setStatus(`연결됨 — ${describe(port)}`, "ok"); refreshButtons(); }
    });
    // a board allowed once before is remembered by the browser
    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length) { port = ports[0]; setStatus(`연결됨 — ${describe(port)}`, "ok"); }
      else setStatus("발판 보드가 연결되지 않았어요. '보드 연결'을 눌러 선택해 주세요.");
    } catch (err) { setStatus("시리얼 장치를 확인할 수 없어요.", "err"); }
    refreshButtons();
  }

  SF.loadcell = { init, supported, sendTare };
})();
