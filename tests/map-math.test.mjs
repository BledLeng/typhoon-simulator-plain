import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, unproject, fitRegion, zoomAt, worldAt, REGION, formatCoordinate, constrainView, normalizeLongitude } from '../dist/map-math.js';

test('Mercator projection round trips across the region', () => {
  for (let lon = 90; lon <= 180; lon += 5) for (let lat = -10; lat <= 65; lat += 5) {
    const projected = project(lon, lat);
    const inverse = unproject(projected.x, projected.y);
    assert.ok(Math.abs(inverse.longitude - lon) < 1e-9);
    assert.ok(Math.abs(inverse.latitude - lat) < 1e-9);
  }
});
test('initial map includes the complete requested regional bounds on phone and desktop', () => {
  for (const [width, height] of [[390, 844], [844, 390], [1280, 800], [1920, 1080]]) {
    const camera = fitRegion(width, height);
    for (const longitude of [REGION.west, REGION.east]) for (const latitude of [REGION.south, REGION.north]) {
      const point = project(longitude, latitude);
      const x = width / 2 + (point.x - camera.x) * camera.scale;
      const y = height / 2 + (point.y - camera.y) * camera.scale;
      assert.ok(x > 0 && x < width && y > 0 && y < height, `${width}×${height}: ${longitude},${latitude}`);
    }
  }
});
test('zoom retains the exact geographical point under the cursor', () => {
  const camera = fitRegion(1200, 800);
  const anchor = worldAt(camera, 1200, 800, 350, 275);
  const zoomed = zoomAt(camera, 1200, 800, camera.scale * 2.3, 350, 275);
  const after = worldAt(zoomed, 1200, 800, 350, 275);
  assert.ok(Math.abs(after.x - anchor.x) < 1e-12);
  assert.ok(Math.abs(after.y - anchor.y) < 1e-12);
});
test('coordinates describe both hemispheres and extreme latitudes remain finite', () => {
  assert.equal(formatCoordinate(135, 25), '135.00°E · 25.00°N');
  assert.equal(formatCoordinate(-120.5, -3), '120.50°W · 3.00°S');
  assert.ok(Number.isFinite(project(180, 90).y));
});
test('animated zoom uses the same bounds and longitude labels wrap at the date line', () => {
  const home = fitRegion(1280, 800);
  const edge = { ...home, x: Math.PI };
  const target = zoomAt(edge, 1280, 800, home.scale * 2, 1200, 400);
  assert.ok(target.x > Math.PI);
  assert.equal(constrainView(target, home.scale).x, target.x);
  assert.equal(constrainView({ ...target, x: 9 }, home.scale).x, 9);
  assert.equal(normalizeLongitude(190), -170);
  assert.equal(formatCoordinate(190, 25), '170.00°W · 25.00°N');
});
