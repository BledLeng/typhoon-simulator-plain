#!/bin/sh
# Rebuild from the included C source and portable headers. No SDK checkout required.
set -eu
cd "$(dirname "$0")/.."
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
"${CLANG:-clang}" --target=wasm32 -O3 -ffp-contract=off -nostdlib -c native-web/cloud_kernel.c -o "$temp/cloud.o"
"${WASM_LD:-wasm-ld}" --no-entry --export=step --export=__heap_base --export-memory \
  --allow-undefined --initial-memory=131072 --max-memory=268435456 "$temp/cloud.o" -o "$temp/cloud-kernel.wasm"
mv "$temp/cloud-kernel.wasm" dist/cloud-kernel.wasm
