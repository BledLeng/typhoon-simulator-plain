# Typhoon Simulator

**English** · [简体中文](README.zh-CN.md)

Create a disturbance over the ocean, watch it develop, then compare its cloud water, wind radii and infrared signature. This is an offline, browser-based **educational simulation**, not observed weather or a forecast. No API keys, npm setup or proprietary SDK are needed to run it.

### Screenshots

[![Global day/night satellite view. The gold line marks the terminator.](docs/screenshots/day-night.png)](docs/screenshots/day-night.png)

| Cloud water and wind radii | RBTOP enhanced infrared |
| :--: | :--: |
| [![Simulated western Pacific cyclone](docs/screenshots/cyclone.png)](docs/screenshots/cyclone.png) | [![Simulated brightness temperatures at the same time and location](docs/screenshots/infrared.png)](docs/screenshots/infrared.png) |

The close-ups show the **same storm at the same simulation time and camera position**. Infrared colours encode simulated brightness temperature, not wind speed. Click any image for its full resolution.

**One storm over 28 simulated hours.** The camera stays fixed. Watch the centre move relative to the islands and the outer cloud bands change shape. The example starts with an already-organised vortex in the western Pacific; it does not show how quickly a weak disturbance would intensify.

[![Fixed-camera time lapse of a simulated western Pacific storm](docs/screenshots/storm-evolution.gif)](docs/screenshots/storm-evolution.gif)

[Open the demonstration gallery →](docs/gallery.md#english) Compare convection, pressure and the ocean wake at one instant; then try the storm inspector and trigger a wind shear pulse yourself.

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

### How a storm becomes a satellite image

1. **Carry moisture, not a cloud sprite.** The global atmosphere is a 640 × 512 Mercator mesh spanning 85°S to 85°N and wrapping at the date line. It carries water vapour, condensed water, temperature and a rain-cooled air field. Wind transports the existing cloud water; a correction limited to the donor cells’ range preserves edges without inventing negative water. Surface evaporation supplies vapour, condensation makes cloud and rain removes water. Up to three 160 × 160 meshes resolve active regions in more detail. They take boundary conditions from the global field and retain overlapping state as they move. [Global solver](dist/cloud-field.js) · [Nested meshes](dist/cloud-detail.js)
2. **Let the environment steer and intensify the vortex.** A weak disturbance follows the shallow flow; wind strength, warm-core structure and organisation set the weight of the deeper flow. Warm water alone does not guarantee rapid intensification: shear, humidity, ocean heat content and prior organisation affect the response time. Two same-hemisphere vortices within range can gradually turn each other. Their coupling builds over a model timescale of eight hours; close, sustained interaction can lead to absorption, while different steering currents can carry them apart. These are parameterisations, not a solved three-dimensional wind field. [Steering](dist/steering.js) · [Intensity](dist/intensity.js) · [Vortex interaction](dist/simulation.js)
3. **Keep track of what the storm leaves behind.** Wind-driven mixing cools ocean cells along the track. The wake stays on the map when the storm moves away; without further mixing, its temperature deficit falls to about 37% after 240 simulated hours. Mountains have a directional effect: the model keeps a terrain-disruption field with 16 angular sectors and 12 radial bands, so one side of a circulation can weaken more than the other. The dashed outer circulation is a size estimate, not a fourth wind-speed threshold. [Ocean](dist/ocean.js) · [Terrain](dist/terrain-interaction.js) · [Wind radii](dist/wind-rings.js)
4. **Observe the same state in different ways.** Cloud water shows condensate; convection highlights recent condensation activity, not all visible cloud. For infrared, the simulator estimates cloud-top temperature and emissivity, mixes surface and cloud radiance at 10.3 μm, then maps the result to brightness temperature. Thin clouds therefore let some surface warmth through. BW, BD and RBTOP change the colour scale, not the storm. The pressure layer instead combines background pressure with modelled lows and highs; it is not inferred from cloud colour. [Satellite products](dist/cloud-products.js) · [Colour scales](dist/satellite-scales.js) · [Pressure field](dist/pressure-field.js)

**Timing and limits.** Storm motion advances in steps of at most five simulated minutes. The cloud worker exchanges half-hour solutions; the display can blend completed frames at up to 24 Hz. Selecting 24 h/s requests 48 cloud updates per real second. If the device cannot sustain that, the clock slows rather than letting the wind track outrun the cloud field. The worker can use a WebAssembly moisture kernel or its JavaScript reference; cloud rendering separately has WebGL2 and CPU paths. Zooming in does not add measured data: the eye, terrain wake and infrared temperatures are model estimates, not observations. [Clock](dist/cloud-clock.js) · [Worker](dist/cloud-worker.js) · [Cloud presentation](dist/cloud-presentation.js)

### Development and license

- The readable application sources are in `dist/`. Run `node --test tests/*.test.mjs` with Node.js 22+; no test dependencies required.
- Rebuild the WebAssembly kernel with `sh tools/build-cloud-kernel.sh` using wasm32-capable Clang and wasm-ld (`CLANG` / `WASM_LD` may override their paths). This uses `native-web/cloud_kernel.c` and the included headers; the original equations and corresponding C/JS implementations are in `physics/` and `dist/`.
- To rebuild data: see [coastline processing](dist/data/README.md), [climate inputs](tools/build-climate.py), and the terrain scripts in `tools/` (optional dependency `sharp`).
- Original program: [GNU AGPL v3 only](LICENSE) (`AGPL-3.0-only`). Third-party data retain their upstream terms. See [data credits](dist/credits.html) and [terrain attribution](dist/data/terrain-attribution.md).
