#!/usr/bin/env python3
"""리듬 에너지 — local game server for the Raspberry Pi.

Serves the game (the repository's step-five/ folder) at http://localhost:PORT/
and a folder of songs next to it:

  GET /songs/index.json   -> {"folder": "...", "songs": [{name, size, mtime, url}, ...]}
  GET /songs/<file name>  -> that audio file

The game reads songs/index.json on every start and imports any song that
isn't in its library yet, so adding music is just copying files into the
folder. Only the Python standard library is used (preinstalled on Raspberry
Pi OS). Listens on localhost only — nothing is exposed to the network unless
--host is given.

  python3 server.py --port 8000 --songs ~/RhythmEnergy/songs
"""
import argparse
import json
import mimetypes
import os
import shutil
import sys
import urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

AUDIO_EXT = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".opus", ".flac", ".webm"}
GAME_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "step-five"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, songs_dir, **kwargs):
        self.songs_dir = songs_dir
        super().__init__(*args, directory=GAME_DIR, **kwargs)

    def end_headers(self):
        # always hand out the current game files (updates arrive with git pull)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the service log quiet

    def do_GET(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if path == "/songs/index.json":
            return self.send_index()
        if path.startswith("/songs/"):
            return self.send_song(path[len("/songs/"):])
        return super().do_GET()

    def song_files(self):
        if not os.path.isdir(self.songs_dir):
            return []
        out = []
        for entry in os.scandir(self.songs_dir):
            if entry.name.startswith("."):
                continue
            if entry.is_file() and os.path.splitext(entry.name)[1].lower() in AUDIO_EXT:
                out.append(entry)
        return sorted(out, key=lambda e: e.name)

    def send_index(self):
        songs = []
        for entry in self.song_files():
            st = entry.stat()
            songs.append({
                "name": entry.name,
                "size": st.st_size,
                "mtime": int(st.st_mtime * 1000),
                "url": "songs/" + urllib.parse.quote(entry.name),
            })
        body = json.dumps({"folder": self.songs_dir, "songs": songs}, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_song(self, name):
        # a plain file name inside the folder only — no paths, no hidden files
        if not name or "/" in name or "\\" in name or name.startswith("."):
            return self.send_error(404)
        full = os.path.join(self.songs_dir, name)
        if os.path.splitext(name)[1].lower() not in AUDIO_EXT or not os.path.isfile(full):
            return self.send_error(404)
        try:
            f = open(full, "rb")
        except OSError:
            return self.send_error(404)
        with f:
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(os.fstat(f.fileno()).st_size))
            self.end_headers()
            shutil.copyfileobj(f, self.wfile)


def main():
    ap = argparse.ArgumentParser(description="리듬 에너지 local game server")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1", help="127.0.0.1 = this computer only")
    ap.add_argument("--songs", default=os.path.expanduser("~/RhythmEnergy/songs"), help="folder of songs")
    args = ap.parse_args()

    songs_dir = os.path.abspath(os.path.expanduser(args.songs))
    os.makedirs(songs_dir, exist_ok=True)
    if not os.path.isfile(os.path.join(GAME_DIR, "index.html")):
        sys.exit(f"game files not found in {GAME_DIR}")

    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, songs_dir=songs_dir))
    print(f"리듬 에너지: http://localhost:{args.port}/  ·  songs: {songs_dir}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
