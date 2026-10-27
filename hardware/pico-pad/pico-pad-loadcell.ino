// 펌프 발판 v4 (로드셀 방식) - Pico 펌웨어 초안 (실기 미검증)
// 보드: Raspberry Pi Pico (Arduino-Pico 코어), Tools > USB Stack > Adafruit TinyUSB
//
// 하는 일
//  1) HX711 5개(발판당 로드셀 4개)를 읽어 밟힘/뗌을 판정 → USB 키보드(넘패드 1·7·5·9·3)
//  2) 같은 상태를 옵토 모듈로 PLC 입력 X10~X14에 복사(GP12~GP16)
//  3) USB 시리얼 명령(게임이 보냄): 바이트 1개, 0~15
//       하위 3비트 = 점수 단계 0~5 → GP17~GP19 → PLC X15~X17 (옵토 모듈 1)
//       비트 3     = 콤보 노랑 켜짐   → GP20       → PLC X0        (옵토 모듈 2)
//     'd' = 원시값 출력 켜고 끄기, 'z' = 영점 다시 잡기
//     (시리얼 모니터에서 엔터를 치면 바이트 10이 가서 단계 2 + 콤보가 켜집니다. 시험 중에만 주의)
//
// 핀 (v3 설계도와 같음)
//  좌하 DT2/SCK3, 좌상 DT4/SCK5, 중앙 DT6/SCK7, 우상 DT8/SCK9, 우하 DT10/SCK11. HX711 전원은 3V3(36번).
//
// 주의
//  - HX711은 RATE 핀을 80SPS로 개조한 상태를 가정합니다(안 하면 10SPS라 너무 느립니다).
//  - 부팅 직후 약 1초 동안 영점을 잡으므로 발판 위에 아무것도 올리지 마세요.
//  - T_ON, T_OFF는 시작값입니다. 'd'로 원시값을 보며 발판에 맞게 고치세요.
#include <Adafruit_TinyUSB.h>

const uint8_t DT[5]  = {2, 4, 6, 8, 10};
const uint8_t SCK_[5] = {3, 5, 7, 9, 11};
const uint8_t MIR[5] = {12, 13, 14, 15, 16};      // → PLC X10~X14
const uint8_t CMD[4] = {17, 18, 19, 20};          // → PLC X15, X16, X17, X0
const uint8_t KEY[5] = {HID_KEY_KEYPAD_1, HID_KEY_KEYPAD_7, HID_KEY_KEYPAD_5, HID_KEY_KEYPAD_9, HID_KEY_KEYPAD_3};

const int32_t T_ON  = 3000;   // 영점 대비 이만큼 커지면 눌림 (대략 2kg 수준, 실측 필요)
const int32_t T_OFF = 1500;   // 이 밑으로 2번 연속 내려오면 뗌
const uint8_t RELEASE_SAMPLES = 2;

uint8_t const desc_hid_report[] = { TUD_HID_REPORT_DESC_KEYBOARD() };
Adafruit_USBD_HID usb_hid;

int32_t baseV[5];
bool    down[5]    = {false, false, false, false, false};
uint8_t lowCount[5] = {0, 0, 0, 0, 0};
bool    dbg = false;
int32_t lastRaw[5];

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
  if (v & 0x800000) v |= 0xFF000000;
  return (int32_t)v;
}

void sendReport() {
  uint8_t keys[6] = {0, 0, 0, 0, 0, 0};
  uint8_t n = 0;
  for (uint8_t i = 0; i < 5; i++) if (down[i]) keys[n++] = KEY[i];
  while (!usb_hid.ready()) delayMicroseconds(50);
  usb_hid.keyboardReport(0, 0, keys);
}

void zeroAll() {
  for (uint8_t i = 0; i < 5; i++) {
    int64_t sum = 0; uint8_t got = 0;
    uint32_t t0 = millis();
    while (got < 16 && millis() - t0 < 1500) {
      if (digitalRead(DT[i]) == LOW) { sum += readHX(DT[i], SCK_[i]); got++; }
    }
    baseV[i] = got ? (int32_t)(sum / got) : 0;
    down[i] = false; lowCount[i] = 0;
  }
}

void setup() {
  for (uint8_t i = 0; i < 5; i++) {
    pinMode(DT[i], INPUT); pinMode(SCK_[i], OUTPUT); digitalWrite(SCK_[i], LOW);
    pinMode(MIR[i], OUTPUT); digitalWrite(MIR[i], LOW);
  }
  for (uint8_t i = 0; i < 4; i++) { pinMode(CMD[i], OUTPUT); digitalWrite(CMD[i], LOW); }
  Serial.begin(115200);
  usb_hid.setPollInterval(1);
  usb_hid.setReportDescriptor(desc_hid_report, sizeof(desc_hid_report));
  usb_hid.begin();
  while (!TinyUSBDevice.mounted()) delay(1);
  delay(500);
  zeroAll();
}

void loop() {
  bool changed = false;
  for (uint8_t i = 0; i < 5; i++) {
    if (digitalRead(DT[i]) != LOW) continue;                 // 아직 새 값 없음
    int32_t raw = readHX(DT[i], SCK_[i]);
    lastRaw[i] = raw;
    int32_t d = raw - baseV[i];
    if (!down[i]) {
      if (d >= T_ON) { down[i] = true; lowCount[i] = 0; changed = true; }   // 눌림: 첫 샘플에서 바로
      else if (d > -T_ON) baseV[i] += d / 256;                               // 빈 발판일 때만 영점을 천천히 따라감
    } else {
      if (d < T_OFF) { if (++lowCount[i] >= RELEASE_SAMPLES) { down[i] = false; changed = true; } }
      else lowCount[i] = 0;
    }
  }
  if (changed) {
    sendReport();
    for (uint8_t i = 0; i < 5; i++) digitalWrite(MIR[i], down[i] ? HIGH : LOW);
  }
  while (Serial.available()) {
    uint8_t b = Serial.read();
    if (b < 16) { for (uint8_t i = 0; i < 4; i++) digitalWrite(CMD[i], (b >> i) & 1 ? HIGH : LOW); }
    else if (b == 'd') dbg = !dbg;
    else if (b == 'z') zeroAll();
  }
  static uint32_t lastPrint = 0;
  if (dbg && millis() - lastPrint > 50) {
    lastPrint = millis();
    for (uint8_t i = 0; i < 5; i++) { Serial.print(lastRaw[i] - baseV[i]); Serial.print(i < 4 ? ',' : '\n'); }
  }
}
