// 리듬 에너지 — pad controller (reference firmware)
//
// 5 load-cell pads (one HX711 each) -> USB keyboard, plus the serial
// commands the game's settings screen uses (zero, live values, thresholds).
// See ../loadcell-serial-protocol.md.
//
// NOT COMPILED OR TESTED ON HARDWARE — a starting point to adapt.
//
// Boards: anything with native USB keyboard + serial at the same time:
//   Arduino Leonardo / Pro Micro (ATmega32U4), Raspberry Pi Pico (arduino-pico core)
// Libraries: "HX711" by Bogdan Necula (bogde/HX711), Keyboard (built in)
//
// Hardware notes:
//   - Each HX711 must run at 80 samples/s: tie its RATE pin HIGH
//     (most modules ship with RATE tied to GND = 10 SPS = up to 100 ms late).
//   - Power the HX711s from 3.3 V on a 3.3 V board (Pico), so DT never
//     drives 5 V into the GPIO.

#include <HX711.h>
#include <Keyboard.h>
#include <EEPROM.h>

// ---------------- configuration ----------------
// Pad order is the game's: DL, UL, CN, UR, DR.
#if defined(ARDUINO_ARCH_RP2040)
const uint8_t DT_PINS[5]  = {2, 4, 6, 8, 10};
const uint8_t SCK_PINS[5] = {3, 5, 7, 9, 11};
#else // Leonardo / Pro Micro
const uint8_t DT_PINS[5]  = {2, 4, 6, 8, 10};
const uint8_t SCK_PINS[5] = {3, 5, 7, 9, 16};
#endif

// Keys sent for each pad (the game's default mapping is the numpad).
#ifdef KEY_KP_1
const uint8_t KEYS[5] = {KEY_KP_1, KEY_KP_7, KEY_KP_5, KEY_KP_9, KEY_KP_3};
#else
const uint8_t KEYS[5] = {'1', '7', '5', '9', '3'}; // remap once in the game's settings
#endif

// Set true for a pad whose reading goes NEGATIVE when stepped on.
const bool INVERT[5] = {false, false, false, false, false};

// Default thresholds (changed from the game's settings and kept in EEPROM).
// ON must clear what a neighbouring pad can push this one to (measured
// ~30,000 on the centre pad); OFF must stay above that, so moving a foot to
// a neighbour always releases this pad.
const long DEFAULT_ON  = 65000;
const long DEFAULT_OFF = 45000;

// Auto-zero: while a pad is released and reads within ±AUTOZERO_BAND of
// zero, its zero point slowly follows the reading (load cells drift).
const long AUTOZERO_BAND = 5000;
const long AUTOZERO_DIV  = 1024;   // ~13 s time constant at 80 SPS

const unsigned long STREAM_EVERY_MS = 40; // live values ~25 times a second
// ------------------------------------------------

HX711 scales[5];
long offsetRaw[5];
long value[5];
bool pressed[5];
long onTh[5], offTh[5];
bool streaming = false;
unsigned long lastStream = 0;

struct Saved { uint32_t magic; long on[5]; long off[5]; };
const uint32_t MAGIC = 0x52450001; // "RE" v1

void loadThresholds() {
#if defined(ARDUINO_ARCH_RP2040)
  EEPROM.begin(256);
#endif
  Saved s;
  EEPROM.get(0, s);
  for (int i = 0; i < 5; i++) {
    bool ok = s.magic == MAGIC && s.on[i] > s.off[i] && s.off[i] >= 0;
    onTh[i]  = ok ? s.on[i]  : DEFAULT_ON;
    offTh[i] = ok ? s.off[i] : DEFAULT_OFF;
  }
}

void saveThresholds() {
  Saved s;
  s.magic = MAGIC;
  for (int i = 0; i < 5; i++) { s.on[i] = onTh[i]; s.off[i] = offTh[i]; }
  EEPROM.put(0, s);
#if defined(ARDUINO_ARCH_RP2040)
  EEPROM.commit();
#endif
}

void releaseAll() {
  for (int i = 0; i < 5; i++) {
    if (pressed[i]) Keyboard.release(KEYS[i]);
    pressed[i] = false;
  }
}

void tareAll() {
  releaseAll();
  for (int i = 0; i < 5; i++) offsetRaw[i] = scales[i].read_average(8);
}

void handleLine(char *line) {
  if (strcmp(line, "TARE") == 0) {
    tareAll();
    Serial.println("OK TARE");
  } else if (strcmp(line, "STREAM 1") == 0) {
    streaming = true;
    Serial.println("OK STREAM 1");
  } else if (strcmp(line, "STREAM 0") == 0) {
    streaming = false;
    Serial.println("OK STREAM 0");
  } else if (strcmp(line, "TH?") == 0) {
    Serial.print("TH");
    for (int i = 0; i < 5; i++) { Serial.print(' '); Serial.print(onTh[i]); Serial.print(' '); Serial.print(offTh[i]); }
    Serial.println();
  } else if (strncmp(line, "TH ", 3) == 0) {
    int i; long on, off;
    if (sscanf(line + 3, "%d %ld %ld", &i, &on, &off) == 3 && i >= 0 && i < 5 && on > off && off >= 0) {
      onTh[i] = on; offTh[i] = off;
      saveThresholds();
      Serial.print("OK TH "); Serial.print(i); Serial.print(' ');
      Serial.print(on); Serial.print(' '); Serial.println(off);
    } else {
      Serial.println("ERR TH");
    }
  } else if (line[0]) {
    Serial.println("ERR UNKNOWN");
  }
}

void readSerial() {
  static char line[40];
  static uint8_t len = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { line[len] = 0; handleLine(line); len = 0; continue; }
    if (len < sizeof(line) - 1) line[len++] = c;
  }
}

void updatePad(int i, long raw) {
  long v = raw - offsetRaw[i];
  if (INVERT[i]) v = -v;
  value[i] = v;

  // press / release with separate thresholds (hysteresis), so a value
  // hovering around one line can't flicker the key on and off
  if (!pressed[i] && v >= onTh[i]) { pressed[i] = true;  Keyboard.press(KEYS[i]); }
  else if (pressed[i] && v <= offTh[i]) { pressed[i] = false; Keyboard.release(KEYS[i]); }

  if (!pressed[i] && v > -AUTOZERO_BAND && v < AUTOZERO_BAND) {
    offsetRaw[i] += (raw - offsetRaw[i]) / AUTOZERO_DIV;
  }
}

void streamValues() {
  if (!streaming || millis() - lastStream < STREAM_EVERY_MS) return;
  lastStream = millis();
  Serial.print('V');
  for (int i = 0; i < 5; i++) { Serial.print(' '); Serial.print(value[i]); }
  Serial.print(" P ");
  for (int i = 0; i < 5; i++) Serial.print(pressed[i] ? '1' : '0');
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 5; i++) { scales[i].begin(DT_PINS[i], SCK_PINS[i]); pressed[i] = false; value[i] = 0; }
  Keyboard.begin();
  loadThresholds();
  delay(500);     // let the load cells settle — keep off the pads while powering up
  tareAll();
}

void loop() {
  readSerial();
  for (int i = 0; i < 5; i++) {
    if (scales[i].is_ready()) updatePad(i, scales[i].read()); // non-blocking: only when a sample is waiting
  }
  streamValues();
}
