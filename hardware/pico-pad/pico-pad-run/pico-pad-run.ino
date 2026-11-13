// 펌프 발판 v4 (로드셀 방식) - 실제 구동용 Pico 펌웨어 (5장 전체)
// 보드: Raspberry Pi Pico (Arduino-Pico 코어, Earle Philhower), Tools > USB Stack > Adafruit TinyUSB
// 라이브러리를 따로 설치하지 마세요. TinyUSB와 EEPROM은 보드 패키지에 들어 있습니다.
//
// 하는 일
//  1) HX711 5개를 읽어 밟힘/뗌을 판정 → USB 키보드 (넘패드 1·7·5·9·3)
//  2) 같은 상태를 GP12~GP16으로 내보냄 (옵토 → PLC X10~X14)
//  3) 게임이 보내는 조명 명령 바이트(0x80~0x8F)를 GP17~GP20으로 내보냄 (PLC X15~X17, X0)
//
// 연결 안 된 발판은 자동으로 무시합니다 (DT 핀 풀업 → 새 값 없음). 그래서 발판을 하나씩 늘려도 이 파일 그대로 씁니다.
// 값이 처음 들어올 때(부팅, 선 재연결, z) 샘플 16개로 영점을 잡습니다. 그동안 발판에서 내려와 있으세요.
//
// 시리얼 명령 (115200, 줄바꿈 설정은 아무거나. 설정은 Pico에 저장되어 전원을 꺼도 유지)
//   h          도움말
//   s          현재 설정 보기
//   r          발판별 초당 샘플 수 (80SPS 개조면 약 80, 아니면 약 10, 연결 안 됨 0)
//   d          값 흐름 켜기/끄기 (영점 대비 값, 발판 ①~⑤ 순서)
//   z          영점 다시 잡기
//   i3         ③번 발판 방향 뒤집기 (밟으면 음수로 가는 발판)
//   a3         ③번 발판 사용/안 함 바꾸기 (고장 난 발판을 잠시 끌 때)
//   t4000      모든 발판 T_ON = 4000, T_OFF = 2000 (T_OFF는 자동으로 절반)
//   t3:2500    ③번 발판만 T_ON = 2500, T_OFF = 1250
//   f1500      모든 발판 T_OFF = 1500 (t 다음에 따로 정할 때)
//   f3:1000    ③번 발판만 T_OFF = 1000
//   x          공장 초기값으로 되돌리기
//
// 발판 번호와 핀
//   ① 좌하 DT GP2  SCK GP3  → Num1      ② 좌상 DT GP4  SCK GP5  → Num7
//   ③ 중앙 DT GP6  SCK GP7  → Num5      ④ 우상 DT GP8  SCK GP9  → Num9
//   ⑤ 우하 DT GP10 SCK GP11 → Num3      HX711 전원은 3V3(36번), GND(38번). 5V 금지.
#include <Adafruit_TinyUSB.h>
#include <EEPROM.h>

const uint8_t N = 5;
const uint8_t DT[N]   = {2, 4, 6, 8, 10};
const uint8_t SCK_[N] = {3, 5, 7, 9, 11};
const uint8_t MIR[N]  = {12, 13, 14, 15, 16};      // → PLC X10~X14
const uint8_t CMD[4]  = {17, 18, 19, 20};          // → PLC X15, X16, X17, X0
const uint8_t KEY[N]  = {HID_KEY_KEYPAD_1, HID_KEY_KEYPAD_7, HID_KEY_KEYPAD_5, HID_KEY_KEYPAD_9, HID_KEY_KEYPAD_3};
const char* NAME[N]   = {"1 좌하", "2 좌상", "3 중앙", "4 우상", "5 우하"};

const uint8_t RELEASE_SAMPLES = 2;
const uint8_t ZERO_N = 16;

// ---------- 저장되는 설정 ----------
struct Config {
  uint32_t magic;
  uint8_t  active;          // 비트 i = 발판 i 사용
  uint8_t  invert;          // 비트 i = 발판 i 방향 뒤집기
  int32_t  tOn[N];
  int32_t  tOff[N];
};
const uint32_t MAGIC = 0x50414431;   // "PAD1"
Config cfg;

void defaults() {
  cfg.magic = MAGIC; cfg.active = 0b11111; cfg.invert = 0;
  for (uint8_t i = 0; i < N; i++) { cfg.tOn[i] = 3000; cfg.tOff[i] = 1500; }
}
void saveCfg() { EEPROM.put(0, cfg); EEPROM.commit(); }
void loadCfg() {
  EEPROM.get(0, cfg);
  bool ok = cfg.magic == MAGIC;
  for (uint8_t i = 0; ok && i < N; i++) if (cfg.tOn[i] <= 0 || cfg.tOff[i] < 0 || cfg.tOff[i] >= cfg.tOn[i]) ok = false;
  if (!ok) { defaults(); saveCfg(); }
}

// ---------- 상태 ----------
uint8_t const desc_hid_report[] = { TUD_HID_REPORT_DESC_KEYBOARD() };
Adafruit_USBD_HID usb_hid;

int32_t  baseV[N];
bool     down[N];
uint8_t  lowCount[N];
bool     zeroed[N];
int64_t  zSum[N];
uint8_t  zCnt[N];
uint32_t lastSample[N];
int32_t  lastRaw[N];
uint32_t sampleCnt[N];
uint32_t spsStart = 0;
bool     dbg = false;

int32_t readHX(uint8_t dt, uint8_t sck) {
  uint32_t v = 0;
  noInterrupts();
  for (uint8_t i = 0; i < 24; i++) {
    digitalWrite(sck, HIGH); delayMicroseconds(1);
    v = (v << 1) | (digitalRead(dt) ? 1 : 0);
    digitalWrite(sck, LOW);  delayMicroseconds(1);
  }
  digitalWrite(sck, HIGH); delayMicroseconds(1); digitalWrite(sck, LOW);  // 25번째 펄스: 채널 A, 이득 128
  interrupts();
  if (v == 0xFFFFFF) return INT32_MIN;                 // DT가 계속 HIGH = HX711 없음/선 빠짐 → 버림
  if (v & 0x800000) v |= 0xFF000000;
  return (int32_t)v;
}

void sendReport() {
  uint8_t keys[6] = {0, 0, 0, 0, 0, 0};
  uint8_t n = 0;
  for (uint8_t i = 0; i < N; i++) if (down[i]) keys[n++] = KEY[i];
  uint32_t t0 = millis();
  while (!usb_hid.ready() && millis() - t0 < 20) delayMicroseconds(50);
  usb_hid.keyboardReport(0, 0, keys);
  for (uint8_t i = 0; i < N; i++) digitalWrite(MIR[i], down[i] ? HIGH : LOW);
}

void restartZero(uint8_t i) { zeroed[i] = false; zSum[i] = 0; zCnt[i] = 0; down[i] = false; lowCount[i] = 0; }
void zeroAll() { for (uint8_t i = 0; i < N; i++) restartZero(i); sendReport(); }

// ---------- 시리얼 출력 ----------
void showCfg() {
  Serial.println(F("--- 설정 ---"));
  for (uint8_t i = 0; i < N; i++) {
    Serial.print(NAME[i]);
    Serial.print((cfg.active >> i) & 1 ? F("  사용") : F("  끔  "));
    Serial.print((cfg.invert >> i) & 1 ? F("  방향:뒤집음") : F("  방향:기본  "));
    Serial.print(F("  T_ON=")); Serial.print(cfg.tOn[i]);
    Serial.print(F("  T_OFF=")); Serial.print(cfg.tOff[i]);
    Serial.print(F("  상태:"));
    if (millis() - lastSample[i] > 1000 || lastSample[i] == 0) Serial.println(F("값 없음(연결 확인)"));
    else if (!zeroed[i]) Serial.println(F("영점 잡는 중"));
    else Serial.println(down[i] ? F("눌림") : F("대기"));
  }
}
void help() {
  Serial.println(F("명령: s 설정 | r 속도 | d 값흐름 | z 영점 | i3 3번 방향뒤집기 | a3 3번 켜기/끄기"));
  Serial.println(F("      t4000 전체 T_ON(T_OFF는 절반) | t3:2500 3번만 | f1500 전체 T_OFF | f3:1000 3번만 | x 초기화"));
}

// ---------- 명령 처리 ----------
char   line[24];
uint8_t lineLen = 0;
uint32_t lastChar = 0;

bool parseNum(const char* s, int32_t& out) {
  if (!*s) return false;
  int32_t v = 0;
  for (; *s; s++) { if (*s < '0' || *s > '9') return false; v = v * 10 + (*s - '0'); if (v > 8000000) return false; }
  out = v; return true;
}

void setThreshold(bool isOn, const char* arg) {
  int pad = -1; int32_t v;
  const char* colon = strchr(arg, ':');
  if (colon) {
    if (colon - arg != 1 || arg[0] < '1' || arg[0] > '5') { Serial.println(F("발판 번호는 1~5")); return; }
    pad = arg[0] - '1'; arg = colon + 1;
  }
  if (!parseNum(arg, v) || v <= 0) { Serial.println(F("숫자를 확인하세요 (예: t4000, t3:2500)")); return; }
  for (uint8_t i = 0; i < N; i++) {
    if (pad >= 0 && i != pad) continue;
    if (isOn) { cfg.tOn[i] = v; cfg.tOff[i] = v / 2; }
    else {
      if (v >= cfg.tOn[i]) { Serial.print(NAME[i]); Serial.println(F(": T_OFF는 T_ON보다 작아야 해요")); continue; }
      cfg.tOff[i] = v;
    }
  }
  saveCfg(); showCfg();
}

void runCommand(const char* c) {
  if (!c[0]) return;
  char k = c[0]; const char* arg = c + 1;
  if (k == 'h' || k == '?') help();
  else if (k == 's') showCfg();
  else if (k == 'd') dbg = !dbg;
  else if (k == 'z') { zeroAll(); Serial.println(F("영점 다시 잡는 중... 발판에서 내려와 있으세요")); }
  else if (k == 'r') {
    uint32_t dtms = millis() - spsStart; if (!dtms) dtms = 1;
    for (uint8_t i = 0; i < N; i++) { Serial.print((sampleCnt[i] * 1000UL) / dtms); Serial.print(i < N - 1 ? ',' : '\n'); sampleCnt[i] = 0; }
    spsStart = millis();
  }
  else if ((k == 'i' || k == 'a') && arg[0] >= '1' && arg[0] <= '5' && !arg[1]) {
    uint8_t i = arg[0] - '1';
    if (k == 'i') cfg.invert ^= (1 << i); else cfg.active ^= (1 << i);
    restartZero(i); sendReport(); saveCfg(); showCfg();
  }
  else if (k == 't') setThreshold(true, arg);
  else if (k == 'f') setThreshold(false, arg);
  else if (k == 'x') { defaults(); saveCfg(); zeroAll(); showCfg(); }
  else { Serial.print(F("모르는 명령: ")); Serial.println(c); help(); }
}

void pollSerial() {
  while (Serial.available()) {
    uint8_t b = Serial.read();
    if (b >= 0x80 && b <= 0x8F) {                          // 게임 조명 명령: 하위 3비트 점수 단계, 비트3 콤보
      for (uint8_t i = 0; i < 4; i++) digitalWrite(CMD[i], (b >> i) & 1 ? HIGH : LOW);
      continue;
    }
    if (b == '\n' || b == '\r') { line[lineLen] = 0; runCommand(line); lineLen = 0; continue; }
    if (b < 0x20 || b > 0x7E) continue;
    if (b == ' ') continue;
    if (lineLen < sizeof(line) - 1) line[lineLen++] = (char)b;
    lastChar = millis();
  }
  // 줄바꿈 없음으로 보낸 경우: 0.3초 동안 입력이 없으면 명령 끝으로 봄
  if (lineLen && millis() - lastChar > 300) { line[lineLen] = 0; runCommand(line); lineLen = 0; }
}

// ---------- 메인 ----------
void setup() {
  for (uint8_t i = 0; i < N; i++) {
    pinMode(DT[i], INPUT_PULLUP); pinMode(SCK_[i], OUTPUT); digitalWrite(SCK_[i], LOW);
    pinMode(MIR[i], OUTPUT); digitalWrite(MIR[i], LOW);
    down[i] = false; lowCount[i] = 0; lastSample[i] = 0; sampleCnt[i] = 0; lastRaw[i] = 0; baseV[i] = 0;
  }
  for (uint8_t i = 0; i < 4; i++) { pinMode(CMD[i], OUTPUT); digitalWrite(CMD[i], LOW); }
  EEPROM.begin(256);
  loadCfg();
  Serial.begin(115200);
  usb_hid.setPollInterval(1);
  usb_hid.setReportDescriptor(desc_hid_report, sizeof(desc_hid_report));
  usb_hid.begin();
  uint32_t t0 = millis();
  while (!TinyUSBDevice.mounted() && millis() - t0 < 3000) delay(1);
  delay(300);
  zeroAll();
}

void loop() {
  bool changed = false;
  uint32_t now = millis();
  for (uint8_t i = 0; i < N; i++) {
    if (!((cfg.active >> i) & 1)) { if (down[i]) { down[i] = false; changed = true; } continue; }
    if (digitalRead(DT[i]) != LOW) continue;                 // 아직 새 값 없음 (또는 연결 안 됨)
    int32_t raw = readHX(DT[i], SCK_[i]);
    if (raw == INT32_MIN) continue;
    if ((cfg.invert >> i) & 1) raw = -raw;
    lastRaw[i] = raw; sampleCnt[i]++;
    now = millis();
    if (now - lastSample[i] > 1000) restartZero(i);          // 1초 넘게 끊겼다가 다시 들어오면 영점 다시
    lastSample[i] = now;
    if (!zeroed[i]) {
      zSum[i] += raw;
      if (++zCnt[i] >= ZERO_N) { baseV[i] = (int32_t)(zSum[i] / zCnt[i]); zeroed[i] = true; }
      continue;
    }
    int32_t d = raw - baseV[i];
    if (!down[i]) {
      if (d >= cfg.tOn[i]) { down[i] = true; lowCount[i] = 0; changed = true; }
      else if (d > -cfg.tOn[i]) baseV[i] += d / 256;          // 빈 발판일 때만 영점을 천천히 따라감
    } else {
      if (d < cfg.tOff[i]) { if (++lowCount[i] >= RELEASE_SAMPLES) { down[i] = false; changed = true; } }
      else lowCount[i] = 0;
    }
  }
  now = millis();
  for (uint8_t i = 0; i < N; i++)                             // 값이 0.3초 넘게 안 들어오면 키를 놓음
    if (down[i] && now - lastSample[i] > 300) { down[i] = false; lowCount[i] = 0; changed = true; }
  if (changed) sendReport();

  pollSerial();

  static uint32_t lastPrint = 0;
  if (dbg && millis() - lastPrint > 50) {
    lastPrint = millis();
    for (uint8_t i = 0; i < N; i++) { Serial.print(zeroed[i] ? lastRaw[i] - baseV[i] : 0); Serial.print(i < N - 1 ? ',' : '\n'); }
  }
}
