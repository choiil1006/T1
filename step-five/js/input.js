// All physical input: keyboard, gamepad/dance-pad (as a gamepad), and mouse
///touch on the lane receptors themselves (so the game is fully playable
// without any pad, which matters for testing and for anyone without one).
(function () {
  "use strict";

  const state = SF.state;

  function keyLabel(code) {
    return code.replace("Numpad", "Num").replace("Key", "").replace("Digit", "").replace("Arrow", "");
  }
  function laneForKeyCode(code) {
    for (const l of SF.LANES) {
      const m = state.mapping[l];
      if (m.type === "key" && m.code === code) return l;
    }
    return null;
  }
  function laneForGamepadButton(gpIndex, btnIndex) {
    for (const l of SF.LANES) {
      const m = state.mapping[l];
      if (m.type === "gamepad" && m.gpIndex === gpIndex && m.btnIndex === btnIndex) return l;
    }
    return null;
  }

  function renderPadSlot(lane) {
    const slot = document.querySelector(`.padSlot[data-lane="${lane}"]`);
    slot.querySelector(".key").textContent = state.mapping[lane].label;
  }

  function assignMapping(lane, mapObj) {
    state.mapping[lane] = mapObj;
    renderPadSlot(lane);
    document.querySelector(`.padSlot[data-lane="${lane}"]`).classList.remove("listening");
    state.listeningLane = null;
    SF.$("padStatus").textContent = `[${lane}] 등록 완료: ${mapObj.label}`;
    SF.$("padStatus").classList.add("ok");
    SF.storage.persistGlobalSettings();
  }

  function initPadSlots() {
    document.querySelectorAll(".padSlot").forEach((slot) => {
      slot.addEventListener("click", () => {
        document.querySelectorAll(".padSlot").forEach((s) => s.classList.remove("listening"));
        state.listeningLane = slot.dataset.lane;
        slot.classList.add("listening");
        SF.$("padStatus").textContent = `[${slot.dataset.lane}] 입력을 기다리는 중… 발판을 밟거나 키를 누르세요.`;
        SF.$("padStatus").classList.remove("ok");
      });
    });
  }

  function dispatchPress(lane) {
    if (state.listeningLane) return; // calibration handled by the raw key/gamepad handlers
    if (state.edRecording) { SF.editor.recordNote(lane); return; }
    if (state.running && !state.paused) SF.game.handleHit(lane);
  }

  function initKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (state.listeningLane) {
        e.preventDefault();
        assignMapping(state.listeningLane, { type: "key", code: e.code, label: keyLabel(e.code) });
        return;
      }
      if (e.code === "Escape" && state.running) { SF.game.togglePause(); return; }
      const lane = laneForKeyCode(e.code);
      if (lane) {
        state.laneHeld[lane] = true;
        if (e.repeat) return; // OS auto-repeat while held — state already recorded, don't re-judge
        dispatchPress(lane);
      }
    });

    window.addEventListener("keyup", (e) => {
      const lane = laneForKeyCode(e.code);
      if (lane) state.laneHeld[lane] = false;
    });
  }

  function pollGamepads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let gi = 0; gi < pads.length; gi++) {
      const gp = pads[gi];
      if (!gp) continue;
      for (let bi = 0; bi < gp.buttons.length; bi++) {
        const pressed = gp.buttons[bi].pressed || gp.buttons[bi].value > 0.5;
        const key = gi + "_" + bi;
        const wasPressed = !!state.gpPrevPressed[key];
        const hLane = laneForGamepadButton(gi, bi);
        if (hLane) state.laneHeld[hLane] = pressed;
        if (pressed && !wasPressed) {
          if (state.listeningLane) {
            assignMapping(state.listeningLane, { type: "gamepad", gpIndex: gi, btnIndex: bi, label: `Pad${gi}·B${bi}` });
          } else if (hLane) {
            dispatchPress(hLane);
          }
        }
        state.gpPrevPressed[key] = pressed;
      }
    }
    requestAnimationFrame(pollGamepads);
  }

  function initGamepadEvents() {
    window.addEventListener("gamepadconnected", (e) => {
      if (!state.running) {
        SF.$("padStatus").textContent = `게임패드 연결됨: ${e.gamepad.id}`;
        SF.$("padStatus").classList.add("ok");
      }
    });
    requestAnimationFrame(pollGamepads);
  }

  // -- mouse/touch on the lane receptors: press-and-hold works exactly like
  //    a physical pad, including for hold notes --
  function initPointerLanes() {
    SF.LANES.forEach((lane) => {
      const laneEl = document.querySelector(`.lane[data-lane="${lane}"]`);
      if (!laneEl) return;
      laneEl.classList.add("touchable");
      const press = (e) => {
        e.preventDefault();
        SF.sfx.unlock();
        state.laneHeld[lane] = true;
        dispatchPress(lane);
      };
      const release = () => { state.laneHeld[lane] = false; };
      laneEl.addEventListener("pointerdown", press);
      laneEl.addEventListener("pointerup", release);
      laneEl.addEventListener("pointerleave", release);
      laneEl.addEventListener("pointercancel", release);
    });
  }

  function init() {
    initPadSlots();
    initKeyboard();
    initGamepadEvents();
    initPointerLanes();
  }

  SF.input = { init, assignMapping, renderPadSlot, laneForKeyCode, laneForGamepadButton };
})();
