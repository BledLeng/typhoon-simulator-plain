import { REGION, clamp, project, unproject, fitRegion, worldAt, zoomAt, formatCoordinate, constrainView, normalizeLongitude, traceLandRing } from './map-math.js';
import { WeatherSandbox } from './weather.js?v=global-39';
import { Terrain } from './terrain.js';
import { TerrainRaster } from './terrain-raster.js';
import { LandIndex } from './land-index.js';

const canvas = document.querySelector('#map');
const context = canvas.getContext('2d', { alpha: false });
const status = document.querySelector('#status');
const retry = document.querySelector('#retry');
const coordinates = document.querySelector('#coordinates');
const zoomIn = document.querySelector('#zoom-in');
const zoomOut = document.querySelector('#zoom-out');
const gridToggle = document.querySelector('#grid-toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const pointers = new Map();
const palette = { sea: '#8bc4e6', land: '#79b782', coast: '#57926b' };
const labels = [
  ['中国', 112, 35, 'land'], ['日本', 139, 38, 'land'], ['朝鲜半岛', 128, 40, 'land'],
  ['中国台湾', 122.5, 24, 'small'], ['菲律宾', 124, 12, 'land'], ['越南', 106, 18, 'small'],
  ['南海', 113.8, 15.5, 'sea'], ['东海', 125, 29, 'sea'],
  ['西 北 太 平 洋', 150, 25, 'ocean'],
  ['北美洲', -105, 42, 'land'], ['南美洲', -63, -16, 'land'], ['欧洲', 18, 51, 'land'],
  ['非洲', 20, 3, 'land'], ['澳大利亚', 134, -25, 'land'], ['南极洲', 0, -75, 'land'],
  ['北 大 西 洋', -40, 25, 'ocean'], ['南 大 西 洋', -20, -30, 'ocean'],
  ['印 度 洋', 75, -15, 'ocean'], ['南 太 平 洋', -135, -25, 'ocean'], ['地中海', 18, 36, 'small'],
];
let width = 1, height = 1, ratio = 1;
let camera = fitRegion(900, 700);
let homeScale = camera.scale;
let landPath = null;
let coastPath = null;
let loaded = false;
let showGrid = true;
let frame = 0;
let animation = null;
let gesture = null;
let weather = null;
let tapCandidate = null;
const terrain = new TerrainRaster();
const satelliteCoasts = new TerrainRaster(true);
const coastlineInk = { coast:'rgba(255,214,98,.78)' };
let paintedKey = '';

function requestDraw() {
  if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
}

function screenPoint(longitude, latitude, wrap = true) {
  const point = project(longitude, latitude);
  if (wrap) point.x += Math.round((camera.x - point.x) / (Math.PI * 2)) * Math.PI * 2;
  return { x: width / 2 + (point.x - camera.x) * camera.scale, y: height / 2 + (point.y - camera.y) * camera.scale };
}

function constrainCamera() {
  camera = constrainView(camera, homeScale, height);
}

function drawGrid() {
  context.strokeStyle = 'rgba(31, 88, 120, .12)';
  context.lineWidth = .65;
  context.beginPath();
  const step = camera.scale > homeScale * 8 ? 5 : camera.scale > homeScale * 2 ? 10 : 30;
  const west = unproject(camera.x - width / 2 / camera.scale, 0).longitude;
  const east = unproject(camera.x + width / 2 / camera.scale, 0).longitude;
  const gridWest = Math.floor(west / step) * step;
  for (let longitude = gridWest; longitude <= east; longitude += step) {
    const { x } = screenPoint(longitude, 0, false);
    if (x < 0 || x > width) continue;
    context.moveTo(x, 0); context.lineTo(x, height);
  }
  for (let latitude = -80; latitude <= 80; latitude += step) {
    const { y } = screenPoint(0, latitude);
    if (y < 0 || y > height) continue;
    context.moveTo(0, y); context.lineTo(width, y);
  }
  context.stroke();
  context.fillStyle = 'rgba(37, 83, 105, .53)';
  context.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  context.textAlign = 'center';
  for (let longitude = gridWest; longitude <= east; longitude += step) {
    const { x } = screenPoint(longitude, 0, false);
    if (x < 36 || x > width - 36) continue;
    const label = normalizeLongitude(longitude);
    context.fillText(`${Math.abs(label)}°${label < 0 ? 'W' : 'E'}`, x, height - 54);
  }
  context.textAlign = 'left';
  for (let latitude = -30; latitude <= 70; latitude += step) {
    const { y } = screenPoint(0, latitude);
    if (y < 120 || y > height - 76) continue;
    context.fillText(`${Math.abs(latitude)}°${latitude < 0 ? 'S' : 'N'}`, 12, y - 6);
  }
}

function drawLabels() {
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const [text, longitude, latitude, kind] of labels) {
    const { x, y } = screenPoint(longitude, latitude);
    if (x < 32 || x > width - 32 || y < 115 || y > height - 72) continue;
    const size = kind === 'ocean' ? (width < 600 ? 15 : 20) : kind === 'small' ? 10 : 12;
    context.font = `${kind === 'ocean' ? 400 : 500} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
    context.fillStyle = kind === 'land' || kind === 'small' ? 'rgba(31, 77, 47, .76)' : 'rgba(32, 91, 128, .56)';
    context.fillText(text, x, y);
  }
  context.textBaseline = 'alphabetic';
}

function draw(time) {
  frame = 0;
  if (weather) {
    const nw = unproject(camera.x - width / 2 / camera.scale, camera.y - height / 2 / camera.scale);
    const se = unproject(camera.x + width / 2 / camera.scale, camera.y + height / 2 / camera.scale);
    weather.clouds.view = { west: nw.longitude, east: se.longitude, north: nw.latitude, south: se.latitude };
  }
  weather?.update(time);
  if (animation) {
    const progress = clamp((time - animation.started) / 230, 0, 1);
    const eased = 1 - (1 - progress) ** 3;
    for (const key of ['x', 'y', 'scale']) camera[key] = animation.from[key] + (animation.to[key] - animation.from[key]) * eased;
    if (progress === 1) animation = null;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const currentTerrainKey = [width, height, ratio, camera.x, camera.y, camera.scale, loaded, showGrid].join(':');
  const weatherKey = weather ? `${weather.clouds.frameCount}:${weather.sim.selectedId}:${weather.sim.heading}:${weather.clouds.showWindRings}` : '';
  const currentPaintKey = `${currentTerrainKey}:${weatherKey}`;
  if (paintedKey === currentPaintKey) {
    if (animation || weather?.running || weather?.clouds.presentation.active) requestDraw();
    return;
  }
  paintedKey = currentPaintKey;
  const renderStarted = performance.now();
  terrain.draw(context, camera, width, height, ratio, landPath, coastPath, palette);
  if (showGrid) drawGrid();
  if (loaded) drawLabels();
  weather?.draw(context, camera.scale, width, height, drawSatelliteCoasts);
  const atMinimum = camera.scale <= homeScale * 1.001, atMaximum = camera.scale >= homeScale * 47.999;
  if (zoomOut.disabled !== atMinimum) zoomOut.disabled = atMinimum;
  if (zoomIn.disabled !== atMaximum) zoomIn.disabled = atMaximum;
  canvas.dataset.mapRenderMs = String(performance.now() - renderStarted);
  canvas.dataset.terrainBuilds = String(terrain.builds);
  if (animation || weather?.running || weather?.clouds.presentation.active) requestDraw();
}

function drawSatelliteCoasts() {
  if (loaded) satelliteCoasts.draw(context,camera,width,height,ratio,landPath,coastPath,coastlineInk);
}

function animateTo(target) {
  cancelGesture();
  target = constrainView(target, homeScale, height);
  if (reducedMotion.matches) { camera = target; animation = null; }
  else animation = { from: { ...camera }, to: target, started: performance.now() };
  requestDraw();
}

function changeZoom(factor, x = width / 2, y = height / 2, animate = false) {
  const nextScale = clamp(camera.scale * factor, homeScale, homeScale * 48);
  const next = zoomAt(camera, width, height, nextScale, x, y);
  if (animate) animateTo(next);
  else { cancelGesture(); animation = null; camera = next; constrainCamera(); requestDraw(); }
}

function resize() {
  const box = canvas.getBoundingClientRect();
  const firstLayout = width === 1;
  const relativeZoom = camera.scale / homeScale;
  width = Math.max(1, box.width); height = Math.max(1, box.height);
  ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const fit = fitRegion(width, height);
  homeScale = Math.max(fit.scale, height / (project(0, -85).y - project(0, 85).y));
  if (firstLayout || relativeZoom < 1.01) camera = fit;
  else camera.scale = homeScale * relativeZoom;
  animation = null; cancelGesture();
  weather?.menu?.close();
  weather?.layerMenu?.close();
  constrainCamera(); requestDraw();
}

function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function beginGesture() {
  const [a, b] = [...pointers.values()];
  if (!a) { gesture = null; return; }
  const center = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
  gesture = { anchor: worldAt(camera, width, height, center.x, center.y), scale: camera.scale, distance: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 };
}

function cancelGesture() {
  // An explicit camera command owns the view until a new pointerdown. Clear
  // state before releasing captures because that dispatches lostpointercapture.
  const capturedPointers = [...pointers.keys()];
  pointers.clear(); gesture = null;
  tapCandidate = null;
  canvas.classList.remove('dragging');
  for (const pointerId of capturedPointers) {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }
}

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || (event.pointerType === 'mouse' && event.ctrlKey)) return;
  const position = point(event);
  if (!pointers.size) {
    tapCandidate = { id: event.pointerId, ...position, slop: event.pointerType === 'mouse' ? 5 : 8 };
  } else {
    tapCandidate = null;
    weather?.pan();
    canvas.classList.add('dragging');
  }
  animation = null;
  pointers.set(event.pointerId, position);
  canvas.setPointerCapture(event.pointerId);
  beginGesture();
});
canvas.addEventListener('pointermove', event => {
  const position = point(event);
  const world = worldAt(camera, width, height, position.x, position.y);
  const location = unproject(world.x, world.y);
  coordinates.textContent = formatCoordinate(location.longitude, location.latitude);
  if (!pointers.size) weather?.move(position);
  if (!pointers.has(event.pointerId)) return;
  if (tapCandidate?.id === event.pointerId) {
    if (Math.hypot(position.x - tapCandidate.x, position.y - tapCandidate.y) <= tapCandidate.slop) return;
    tapCandidate = null;
    weather?.pan();
    canvas.classList.add('dragging');
    beginGesture(); // Anchor the drag to the current view, even when following a storm.
  }
  pointers.set(event.pointerId, position);
  const [a, b] = [...pointers.values()];
  const center = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
  if (b && gesture.distance > 0) camera.scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance, homeScale, homeScale * 48);
  camera.x = gesture.anchor.x - (center.x - width / 2) / camera.scale;
  camera.y = gesture.anchor.y - (center.y - height / 2) / camera.scale;
  constrainCamera(); requestDraw();
});
function endGesture(event) {
  if (!pointers.delete(event.pointerId)) return;
  const tap = tapCandidate;
  tapCandidate = null;
  if (!pointers.size) canvas.classList.remove('dragging');
  beginGesture();
  if (event.type === 'pointerup' && tap?.id === event.pointerId) {
    const p = point(event);
    if (Math.hypot(p.x - tap.x, p.y - tap.y) <= tap.slop) weather?.tap(p);
  }
}
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, endGesture);
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  const position = point(event);
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
  changeZoom(Math.exp(-clamp(pixels, -160, 160) * .002), position.x, position.y);
}, { passive: false });
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('keydown', event => {
  const deltas = { ArrowLeft: [-60, 0], ArrowRight: [60, 0], ArrowUp: [0, -60], ArrowDown: [0, 60] };
  if (event.key in deltas) {
    event.preventDefault(); cancelGesture(); animation = null;
    weather?.pan();
    camera.x += deltas[event.key][0] / camera.scale;
    camera.y += deltas[event.key][1] / camera.scale;
    constrainCamera(); requestDraw();
  } else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(1.5, width / 2, height / 2, true); }
  else if (event.key === '-') { event.preventDefault(); changeZoom(1 / 1.5, width / 2, height / 2, true); }
  else if (event.key === 'Home') { event.preventDefault(); resetView(); }
  else if (event.key === 'Enter') { event.preventDefault(); weather?.tap({ x: width / 2, y: height / 2 }); }
});
function resetView() { weather?.pan(); animateTo(fitRegion(width, height, REGION)); }
zoomIn.addEventListener('click', () => changeZoom(1.5, width / 2, height / 2, true));
zoomOut.addEventListener('click', () => changeZoom(1 / 1.5, width / 2, height / 2, true));
document.querySelector('#reset').addEventListener('click', resetView);
gridToggle.addEventListener('click', () => {
  showGrid = !showGrid;
  gridToggle.setAttribute('aria-pressed', String(showGrid));
  requestDraw();
});

async function loadLand() {
  retry.hidden = true; status.hidden = false; status.textContent = '正在加载海岸线…';
  try {
    const response = await fetch('./data/ne_50m_land.geojson');
    if (!response.ok) throw new Error(`Map data: HTTP ${response.status}`);
    const data = await response.json();
    const path = new Path2D();
    const coast = new Path2D();
    const features = data.type === 'FeatureCollection' ? data.features : [{ geometry: data }];
    for (const { geometry } of features) {
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
      for (const polygon of polygons) for (const ring of polygon) {
        traceLandRing(path, coast, ring);
      }
    }
    const elevation = await Terrain.load();
    const landIndex = new LandIndex(data);
    landPath = path; coastPath = coast; loaded = true; status.hidden = true;
    if (!weather) weather = new WeatherSandbox({
      canvas, screenPoint, invalidate: requestDraw,
      elevation: (lon, lat) => elevation.elevation(lon, lat),
      locate: p => { const w = worldAt(camera, width, height, p.x, p.y); return unproject(w.x, w.y); },
      isLand: (lon, lat) => landIndex.contains(lon, lat),
      makeLandMask: (w, h, bounds) => {
        const raster = document.createElement('canvas'); raster.width = w; raster.height = h;
        const ctx = raster.getContext('2d', { willReadFrequently: true });
        const a = project(bounds.west, bounds.north), b = project(bounds.east, bounds.south);
        ctx.setTransform(w / (b.x - a.x), 0, 0, h / (b.y - a.y), -a.x * w / (b.x - a.x), -a.y * h / (b.y - a.y));
        ctx.fillStyle = '#fff'; ctx.fill(landPath, 'evenodd');
        ctx.translate(Math.PI * 2, 0); ctx.fill(landPath, 'evenodd');
        const rgba = ctx.getImageData(0, 0, w, h).data;
        return Uint8Array.from({ length: w * h }, (_, i) => rgba[i * 4 + 3] > 127 ? 1 : 0);
      },
      follow: (lon, lat, dt) => {
        animation = null;
        const p = project(lon, lat), amount = 1 - Math.exp(-dt / .22);
        p.x += Math.round((camera.x - p.x) / (Math.PI * 2)) * Math.PI * 2;
        camera.x += (p.x - camera.x) * amount; camera.y += (p.y - camera.y) * amount;
        constrainCamera();
      }
    });
    canvas.dataset.ready = 'true'; requestDraw();
  } catch (error) {
    console.error(error);
    status.textContent = '地图加载失败，请重试';
    retry.hidden = false;
  }
}
retry.addEventListener('click', loadLand);
new ResizeObserver(resize).observe(canvas);
window.addEventListener('resize', resize);
resize();
loadLand();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(frame); frame = 0; cancelGesture(); }
  else requestDraw();
});
