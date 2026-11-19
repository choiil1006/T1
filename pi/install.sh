#!/usr/bin/env bash
# 리듬 에너지 — Raspberry Pi setup (run once, in the Pi's terminal):
#
#   curl -fsSL https://raw.githubusercontent.com/choiil1006/T1/main/pi/install.sh | bash
#
# What it does:
#   1. downloads the game to ~/RhythmEnergy/game (or updates it)
#   2. creates the song folder ~/RhythmEnergy/songs
#   3. installs a background service that serves the game at
#      http://localhost:8000/ on every boot (and pulls game updates first)
#   4. makes the game open full screen when the desktop starts (kiosk)
#
# Options (add after "bash -s --" when piping, e.g. "| bash -s -- --no-kiosk"):
#   --no-kiosk      skip step 4
#   --remove-kiosk  undo step 4 (the game no longer opens at startup)
set -euo pipefail

BASE="$HOME/RhythmEnergy"
GAME="$BASE/game"
SONGS="$BASE/songs"
PORT=8000
REPO="https://github.com/choiil1006/T1.git"
URL="http://localhost:$PORT/"
AUTOSTART="$HOME/.config/autostart/rhythm-energy.desktop"

KIOSK=1
for arg in "$@"; do
  case "$arg" in
    --no-kiosk) KIOSK=0 ;;
    --remove-kiosk) rm -f "$AUTOSTART"; echo "자동 실행을 껐어요. (게임 서버는 그대로 동작합니다)"; exit 0 ;;
    *) echo "알 수 없는 옵션: $arg"; exit 1 ;;
  esac
done

say() { printf '\n\033[1;33m▶ %s\033[0m\n' "$1"; }

say "필요한 프로그램 확인"
need=()
command -v git >/dev/null || need+=(git)
command -v python3 >/dev/null || need+=(python3)
command -v curl >/dev/null || need+=(curl)
if [ ${#need[@]} -gt 0 ]; then
  echo "설치: ${need[*]}"
  sudo apt-get update && sudo apt-get install -y "${need[@]}"
fi

say "게임 내려받기 → $GAME"
mkdir -p "$BASE"
if [ -d "$GAME/.git" ]; then
  git -C "$GAME" pull --ff-only
else
  git clone --depth 1 "$REPO" "$GAME"
fi

say "곡 폴더 만들기 → $SONGS"
mkdir -p "$SONGS"

say "게임 서버를 부팅할 때마다 자동 실행"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/rhythm-energy.service" <<EOF
[Unit]
Description=리듬 에너지 game server
After=network-online.target

[Service]
# pull game updates first; skipped quietly when offline
ExecStartPre=-/usr/bin/timeout 20 /usr/bin/git -C $GAME pull --ff-only
ExecStart=/usr/bin/python3 $GAME/pi/server.py --port $PORT --songs $SONGS
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable rhythm-energy.service >/dev/null
systemctl --user restart rhythm-energy.service
# keep the service running even before anyone logs in to the desktop
sudo loginctl enable-linger "$USER" 2>/dev/null || true

for i in $(seq 1 20); do
  curl -fs "$URL" >/dev/null && break
  sleep 0.5
done
if curl -fs "$URL" >/dev/null; then
  echo "게임 서버 동작 중: $URL"
else
  echo "게임 서버가 응답하지 않아요. 아래 명령으로 원인을 확인해 주세요:"
  echo "  journalctl --user -u rhythm-energy -n 30"
  exit 1
fi

# the kiosk launcher: wait for the server, then open the game full screen
cat > "$BASE/start-game.sh" <<EOF
#!/usr/bin/env bash
for i in \$(seq 1 60); do curl -fs "$URL" >/dev/null && break; sleep 1; done
BROWSER=\$(command -v chromium-browser || command -v chromium)
exec "\$BROWSER" --kiosk --noerrdialogs --disable-infobars --no-first-run \\
  --disable-session-crashed-bubble --password-store=basic \\
  --check-for-update-interval=31536000 \\
  --autoplay-policy=no-user-gesture-required \\
  "$URL"
EOF
chmod +x "$BASE/start-game.sh"

if [ "$KIOSK" = 1 ]; then
  say "바탕화면이 뜨면 게임을 전체화면으로 자동 실행"
  if ! command -v chromium-browser >/dev/null && ! command -v chromium >/dev/null; then
    echo "Chromium 브라우저가 없어 자동 실행은 건너뜁니다. (sudo apt install chromium 후 다시 실행)"
  else
    mkdir -p "$(dirname "$AUTOSTART")"
    cat > "$AUTOSTART" <<EOF
[Desktop Entry]
Type=Application
Name=리듬 에너지
Exec=$BASE/start-game.sh
X-GNOME-Autostart-enabled=true
EOF
    echo "다음 부팅부터 게임이 바로 열립니다. (끄기: Alt+F4)"
  fi
fi

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 설치 끝!
 · 곡 폴더:  $SONGS
   MP3를 여기에 복사하고 게임을 다시 켜면 자동으로 추가돼요.
 · 지금 게임 열기:  $BASE/start-game.sh
   (또는 브라우저에서 $URL)
 · 게임은 부팅할 때마다 GitHub의 최신 버전으로 자동 업데이트돼요.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
