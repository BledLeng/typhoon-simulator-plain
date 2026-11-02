# Typhoon Simulator · Plain Edition

**English** · [简体中文](README.zh-CN.md)

Create a disturbance over the ocean, watch it develop, then compare its cloud water, wind radii and infrared signature. This is an offline, browser-based **educational simulation**, not observed weather or a forecast. No API keys, npm setup or proprietary SDK are needed to run it.

### Screenshots

[![Global day/night satellite view. The gold line marks the terminator.](docs/screenshots/day-night.png)](docs/screenshots/day-night.png)

| Cloud water and wind radii | RBTOP enhanced infrared |
| :--: | :--: |
| [![Simulated western Pacific cyclone](docs/screenshots/cyclone.png)](docs/screenshots/cyclone.png) | [![Simulated brightness temperatures at the same time and location](docs/screenshots/infrared.png)](docs/screenshots/infrared.png) |

The close-ups show the **same storm at the same simulation time and camera position**. Infrared colours encode simulated brightness temperature, not wind speed. Click any image for its full resolution.

### Run locally

Clone the repository or **extract the whole ZIP**. Install Python 3.8+ if needed.

| Platform | Launch |
| --- | --- |
| macOS | Double-click [Start-macOS.command](Start-macOS.command), or run `sh Start-macOS.command` in the repository folder. |
| Windows | Double-click [Start-Windows.cmd](Start-Windows.cmd). |
| Terminal | Run `python3 tools/serve.py` (on Windows, `py -3 tools/serve.py`). |

The launcher opens your default browser at [localhost:8786](http://127.0.0.1:8786/). If that port is in use it picks a free one and prints the address. It only listens on loopback. Press **Ctrl+C** to stop; pass `--no-browser` to skip opening a tab. For static hosting, serve the contents of `dist/` over HTTP(S), not `file://`.

### Language and controls

English is the default on first launch. Click **中文** to switch to Simplified Chinese or **English** to switch back; the app remembers your choice. Switching preserves the current simulation, clock and map view. Use `?lang=en` or `?lang=zh` to open a specific language.

- **Left-drag** to pan; click empty space to create a system. Scroll or pinch to zoom.
- **Click a storm** to inspect it. Press **Shift** to guide its direction; **Esc** releases it. The environment sets its speed.
- **Map layers** includes cloud water, convection, infrared and environmental fields. In **Day / night**, the gold terminator follows simulated UTC and the night side uses thermal infrared.
- **Environment** adjusts humidity, shear, ridge movement, season and weather events.

### Model and data

Storm IDs are basin-specific (e.g. 99W, 01W); the Mediterranean suffix M is a simulator extension. Tropical and subtropical systems receive regional names at 34 kt; these are original lists, not the official WMO naming lists. Random initial circulation radii span 70–800 km; manual radii span 70–2,600 km.

The model interpolates 1991–2020 NOAA ERSSTv5 and NCEP/NCAR monthly normals on a 5° grid. Background shear is the magnitude of the **difference of the monthly mean wind vectors** at 200 and 850 hPa, not the monthly mean instantaneous shear. Local coastlines, terrain and storm evolution are simplified.

### Development and license

- The readable application sources are in `dist/`. Run `node --test tests/*.test.mjs` with Node.js 22+; no test dependencies required.
- Rebuild the WebAssembly kernel with `sh tools/build-cloud-kernel.sh` using wasm32-capable Clang and wasm-ld (`CLANG` / `WASM_LD` may override their paths). This uses `native-web/cloud_kernel.c` and the included headers; the original equations and corresponding C/JS implementations are in `physics/` and `dist/`.
- To rebuild data: see [coastline processing](dist/data/README.md), [climate inputs](tools/build-climate.py), and the terrain scripts in `tools/` (optional dependency `sharp`).
- Original program: [GNU AGPL v3 only](LICENSE) (`AGPL-3.0-only`). Third-party data retain their upstream terms. See [data credits](dist/credits.html) and [terrain attribution](dist/data/terrain-attribution.md).
