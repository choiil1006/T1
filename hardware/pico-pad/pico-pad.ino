// 펌프 발판 v4 - Pico 펌웨어 초안 (실기 미검증)
// 보드: Raspberry Pi Pico (Arduino-Pico 코어), Tools > USB Stack > Adafruit TinyUSB
//
// 하는 일
//  1) 발판 스위치 5개(GP2~GP6) → USB 키보드(넘패드 1·7·5·9·3)  : 판정용, 지연 최소
//  2) 같은 상태를 옵토 모듈로 PLC 입력 X10~X14에 복사(GP10~GP14)   : 조명·모터 로직용
//  3) USB 시리얼로 1바이트(하위 3비트)를 받아 GP15~GP17 → PLC X15~X17 : 게임이 PLC에 보내는 명령
//
// 설계 원칙
//  - 눌림은 디바운스 없이 첫 신호에서 바로 보냅니다 (지연 0).
//  - 뗌만 4ms 동안 안정된 뒤에 보냅니다 (접점 채터링 방지).
//  - USB 폴링 간격 1ms. PLC 쪽 출력은 키보드 보고서를 보낸 뒤에 갱신합니다.
#include <Adafruit_TinyUSB.h>

const uint8_t PIN[5]  = {2, 3, 4, 5, 6};          // 좌하, 좌상, 중앙, 우상, 우하 (DL, UL, CN, UR, DR)
const uint8_t MIR[5]  = {10, 11, 12, 13, 14};     // → PLC X10~X14 (옵토 모듈 입력)
const uint8_t CMD[3]  = {15, 16, 17};             // → PLC X15~X17 (전체 점등, 조명 끔, 모터 예약)
const uint8_t KEY[5]  = {HID_KEY_KEYPAD_1, HID_KEY_KEYPAD_7, HID_KEY_KEYPAD_5, HID_KEY_KEYPAD_9, HID_KEY_KEYPAD_3};
const uint32_t RELEASE_US = 4000;

uint8_t const desc_hid_report[] = { TUD_HID_REPORT_DESC_KEYBOARD() };
Adafruit_USBD_HID usb_hid;

bool     down[5]      = {false, false, false, false, false};
uint32_t highSince[5] = {0, 0, 0, 0, 0};

void sendReport() {
  uint8_t keys[6] = {0, 0, 0, 0, 0, 0};
  uint8_t n = 0;
  for (uint8_t i = 0; i < 5; i++) if (down[i]) keys[n++] = KEY[i];
  while (!usb_hid.ready()) delayMicroseconds(50);
  usb_hid.keyboardReport(0, 0, keys);
}

void setup() {
  for (uint8_t i = 0; i < 5; i++) {
    pinMode(PIN[i], INPUT_PULLUP);                 // 외부 4.7kΩ 풀업을 달면 더 안정적
    pinMode(MIR[i], OUTPUT); digitalWrite(MIR[i], LOW);
  }
  for (uint8_t i = 0; i < 3; i++) { pinMode(CMD[i], OUTPUT); digitalWrite(CMD[i], LOW); }
  Serial.begin(115200);
  usb_hid.setPollInterval(1);
  usb_hid.setReportDescriptor(desc_hid_report, sizeof(desc_hid_report));
  usb_hid.begin();
  while (!TinyUSBDevice.mounted()) delay(1);
}

void loop() {
  bool changed = false;
  uint32_t now = micros();
  for (uint8_t i = 0; i < 5; i++) {
    bool low = (digitalRead(PIN[i]) == LOW);        // 스위치가 닫히면 LOW
    if (low) {
      highSince[i] = 0;
      if (!down[i]) { down[i] = true; changed = true; }          // 눌림: 즉시
    } else if (down[i]) {
      if (highSince[i] == 0) highSince[i] = now ? now : 1;
      else if ((uint32_t)(now - highSince[i]) >= RELEASE_US) {   // 뗌: 4ms 안정 후
        down[i] = false; highSince[i] = 0; changed = true;
      }
    }
  }
  if (changed) {
    sendReport();                                   // 먼저 게임으로
    for (uint8_t i = 0; i < 5; i++) digitalWrite(MIR[i], down[i] ? HIGH : LOW);  // 그다음 PLC로
  }
  while (Serial.available()) {                      // 게임 → PLC 명령: 하위 3비트 = X15, X16, X17
    uint8_t b = Serial.read();
    for (uint8_t i = 0; i < 3; i++) digitalWrite(CMD[i], (b >> i) & 1 ? HIGH : LOW);
  }
}
