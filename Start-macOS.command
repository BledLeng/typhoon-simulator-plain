#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' 'Python 3 is required: https://www.python.org/downloads/macos/'
  read -r _
  exit 1
fi
exec python3 tools/serve.py "$@"
