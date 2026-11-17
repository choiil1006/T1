# 발판 보드 ↔ 게임: 로드셀 영점 명령

게임 설정 화면의 **LOAD CELL → 영점 재설정** 버튼은 발판 보드(HX711을 읽고 USB 키보드 신호를 보내는 마이크로컨트롤러)에 USB 시리얼로 명령을 보냅니다. 보드 펌웨어가 아래 명령에 응답해야 동작합니다.

## 규격

| 항목 | 값 |
|---|---|
| 통신 | USB 시리얼(CDC), 115200 baud |
| 형식 | ASCII 한 줄, 끝은 `\n` |
| 게임 → 보드 | `TARE` |
| 보드 → 게임 | 모든 발판의 영점을 다시 잡은 뒤 `OK TARE` |
| 응답 제한시간 | 4초 (넘으면 게임이 "응답 없음"으로 표시) |

- 보드는 USB 키보드(HID)와 USB 시리얼을 **동시에** 지원해야 합니다. Arduino Leonardo / Pro Micro, Raspberry Pi Pico(Arduino-Pico 코어), ESP32-S3는 기본으로 둘 다 됩니다.
- 브라우저 쪽은 Web Serial을 쓰므로 PC·라즈베리파이의 Chrome/Edge에서만 동작합니다(https 또는 localhost).
- 게임은 버튼을 누른 뒤 3초 기다렸다가 명령을 보냅니다(발을 내릴 시간).

## 펌웨어에 추가할 코드 (Arduino, 예시)

`bogde/HX711` 라이브러리로 HX711 5개를 `scales[5]`로 쓰는 경우의 예시입니다. **실제 보드에서 컴파일·검증하지 않은 예시**이니 쓰시는 코드에 맞춰 이름을 바꿔 넣어주세요.

```cpp
// setup() 안에서
Serial.begin(115200);

// loop() 안에서 매번 호출
void handleSerialCommands() {
  static char line[32];
  static uint8_t len = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (len < sizeof(line) - 1) line[len++] = c; continue; }
    line[len] = 0; len = 0;
    if (strcmp(line, "TARE") == 0) {
      for (int i = 0; i < 5; i++) scales[i].tare(8);   // 각 발판 8샘플 평균으로 영점
      releaseAllKeys();                                 // 영점 잡는 동안 눌린 키가 남지 않게
      Serial.println("OK TARE");
    }
  }
}
```

## 함께 넣기를 권하는 것

- **눌림/뗌 기준 분리(히스테리시스)**: `ON = 올려둔 값 + (밟은 값 − 올려둔 값) × 0.5`, `OFF = 올려둔 값 + (밟은 값 − 올려둔 값) × 0.25`. 측정 전 시작값은 ON 60,000 / OFF 35,000.
- **HX711 80SPS**: RATE 핀을 HIGH로. 기본 10SPS면 입력이 최대 0.1초 늦습니다.
- **자동 영점 보정**: 발판이 몇 초 동안 OFF 기준 아래로 조용하면 영점을 아주 천천히 따라가게 해서 드리프트를 없앱니다.
- **키는 누르는 동안 유지**: 눌림이면 `Keyboard.press`, 뗌이면 `Keyboard.release`(홀드 노트 때문).
