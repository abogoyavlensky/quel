"""A stand-in for GitHub's releases API, for e2e and the hand-run update test.

    python3 -I github-stub.py PORT PLATFORM ARCH [--dir DIR --version X.Y.Z]

Serves /repos/abogoyavlensky/quel/releases/latest with one release, its
asset quel_<version>_<platform>_<arch>.zip and checksums.txt. Without
--dir the zip is a few placeholder bytes, version 99.0.0; with --dir it
serves DIR's real quel_<version>_darwin_arm64.zip and checksums.txt.
POST /_version with a version as the body changes the served version, so
a test can offer one no earlier run has skipped.
"""

import hashlib
import http.server
import json
import os
import sys

port, platform, arch = int(sys.argv[1]), sys.argv[2], sys.argv[3]
args = sys.argv[4:]
opts = dict(zip(args[::2], args[1::2]))
real_dir = opts.get("--dir")
state = {"version": opts.get("--version", "99.0.0")}
base = f"http://127.0.0.1:{port}"


def asset_name():
    return f"quel_{state['version']}_{platform}_{arch}.zip"


def payload():
    if real_dir:
        with open(os.path.join(real_dir, asset_name()), "rb") as f:
            return f.read()
    return b"not a real zip"


def checksums():
    if real_dir:
        with open(os.path.join(real_dir, "checksums.txt"), "rb") as f:
            return f.read()
    return f"{hashlib.sha256(payload()).hexdigest()}  {asset_name()}\n".encode()


class Handler(http.server.BaseHTTPRequestHandler):
    def send(self, status, body, ctype="application/octet-stream"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        v = state["version"]
        if self.path == "/repos/abogoyavlensky/quel/releases/latest":
            release = {
                "tag_name": f"v{v}",
                "name": f"Quel {v}",
                "html_url": f"https://github.com/abogoyavlensky/quel/releases/tag/v{v}",
                "published_at": "2026-11-01T10:00:00Z",
                "draft": False,
                "prerelease": False,
                "body": "",
                "assets": [
                    {"name": asset_name(), "size": len(payload()),
                     "browser_download_url": f"{base}/dl/{asset_name()}"},
                    {"name": "checksums.txt", "size": len(checksums()),
                     "browser_download_url": f"{base}/dl/checksums.txt"},
                ],
            }
            self.send(200, json.dumps(release).encode(), "application/json")
        elif self.path == f"/dl/{asset_name()}":
            self.send(200, payload())
        elif self.path == "/dl/checksums.txt":
            self.send(200, checksums(), "text/plain")
        else:
            self.send(404, b"not found", "text/plain")

    def do_POST(self):
        if self.path != "/_version":
            return self.send(404, b"not found", "text/plain")
        n = int(self.headers.get("Content-Length", "0"))
        state["version"] = self.rfile.read(n).decode().strip()
        self.send(200, b"ok", "text/plain")

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
