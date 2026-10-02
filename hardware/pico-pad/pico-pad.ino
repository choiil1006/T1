// 펌프 발판 v4 - Pico 펌웨어 초안 (실기 미검증)
// 보드: Raspberry Pi Pico (Arduino-Pico 코어), Tools > USB Stack > Adafruit TinyUSB
// 발판 5개 → GPIO 5개 → USB 키보드(HID). step-five 기본 매핑(넘패드 1·7·5·9·3)과 같은 키를 보냅니다.
//
// 설계 원칙
//  - 눌림은 디바운스 없이 첫 신호에서 바로 보냅니다 (지연 0).
//  - 뗌만 4ms 동안 안정된 뒤에 보냅니다 (접점 채터링 방지).
//  - USB 폴링 간격 1ms.
#include <Adafruit_TinyUSB.h>

const uint8_t PIN[5]  = {2, 3, 4, 5, 6};   // 좌하, 좌상, 중앙, 우상, 우하 (DL, UL, CN, UR, DR)
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
  for (uint8_t i = 0; i < 5; i++) pinMode(PIN[i], INPUT_PULLUP);  // 외부 4.7kΩ 풀업을 달면 더 안정적
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
  if (changed) sendReport();
}
