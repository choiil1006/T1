# 라즈베리파이에서 리듬 에너지 실행하기

라즈베리파이 안에서 게임을 띄우고, **곡 폴더**에 넣어둔 MP3를 자동으로 불러오는 설정입니다. 업로드 버튼을 쓰지 않아서 USB 파일이 빈 파일로 들어오는 문제도 생기지 않습니다.

## 설치 (처음 한 번)

라즈베리파이에서 터미널을 열고 아래 한 줄을 붙여넣은 뒤 Enter를 누르세요.

```bash
curl -fsSL https://raw.githubusercontent.com/choiil1006/T1/main/pi/install.sh | bash
```

설치가 하는 일:

1. 게임을 `~/RhythmEnergy/game`에 내려받습니다.
2. 곡 폴더 `~/RhythmEnergy/songs`를 만듭니다.
3. 부팅할 때마다 게임 서버(`http://localhost:8000/`)가 자동으로 켜지게 합니다. 켜질 때 GitHub의 최신 게임으로 자동 업데이트합니다(인터넷이 없으면 건너뜀).
4. 바탕화면이 뜨면 게임이 **전체화면으로 바로 열리게** 합니다.

부팅 때 자동으로 열리는 게 싫으면 이렇게 설치하세요.

```bash
curl -fsSL https://raw.githubusercontent.com/choiil1006/T1/main/pi/install.sh | bash -s -- --no-kiosk
```

## 곡 넣기

1. MP3를 `~/RhythmEnergy/songs` 폴더에 복사합니다(파일 관리자에서 홈 → RhythmEnergy → songs). USB에서 바로 복사해도 됩니다.
2. 게임을 다시 켜면 새 곡이 자동으로 추가되고 분석됩니다. 게임을 켠 채로 넣었다면 **설정 → 곡 폴더 → 곡 폴더 다시 읽기**를 누르세요.

## 자주 쓰는 것

| 하고 싶은 것 | 방법 |
|---|---|
| 게임 지금 열기 | `~/RhythmEnergy/start-game.sh` |
| 전체화면 게임 닫기 | `Alt + F4` |
| 부팅 때 자동으로 열리지 않게 | `bash ~/RhythmEnergy/game/pi/install.sh --remove-kiosk` |
| 게임 직접 업데이트 | `git -C ~/RhythmEnergy/game pull` (부팅할 때도 자동으로 함) |
| 서버가 안 될 때 로그 보기 | `journalctl --user -u rhythm-energy -n 30` |

## 참고

- 게임 서버는 이 라즈베리파이 안에서만 접속됩니다(외부 네트워크에 열지 않음).
- 곡은 게임(브라우저) 안에도 저장되므로, 폴더에서 곡을 지워도 게임 목록에는 남아 있습니다. 목록에서 지우려면 설정 → 저장된 곡 관리에서 삭제하세요.
- 이 방식으로 연 게임(`localhost:8000`)과 인터넷 주소(GitHub)로 연 게임은 곡 목록과 기록이 따로 저장됩니다.
