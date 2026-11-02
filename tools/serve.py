"""Serve only the web edition on loopback, then open it in the default browser."""
import argparse
import errno
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import webbrowser


DIST = Path(__file__).resolve().parents[1] / "dist"


class StaticFiles(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".wasm": "application/wasm"}


class LocalServer(ThreadingHTTPServer):
    # A cold module graph can create a connection burst. Python 3.8–3.14
    # otherwise queues only a handful, causing intermittent resets on macOS.
    request_queue_size = 128
    allow_reuse_address = os.name != "nt"


def bind(port):
    handler = partial(StaticFiles, directory=str(DIST))
    try:
        return LocalServer(("127.0.0.1", port), handler)
    except OSError as err:
        if not port or (err.errno != errno.EADDRINUSE and getattr(err, "winerror", None) != 10048):
            raise
        print(f"Port {port} is busy; using another loopback port.", flush=True)
        return LocalServer(("127.0.0.1", 0), handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8786)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    if not (DIST / "index.html").is_file():
        parser.exit(1, "Missing dist/index.html. Extract or clone the entire project first.\n")
    with bind(args.port) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"{url}\nPress Ctrl+C to stop.", flush=True)
        if not args.no_browser:
            Thread(target=webbrowser.open, args=(url,), daemon=True).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
