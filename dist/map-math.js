// Mercator coordinates are in radians; screen-space camera scale is pixels/radian.
export const REGION = Object.freeze({ west: -180, east: 180, south: -70, north: 75 });
const radians = Math.PI / 180;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const normalizeLongitude = value => ((value + 180) % 360 + 360) % 360 - 180;

export function constrainView(camera, homeScale, viewportHeight = 0) {
  const top = project(0, 85).y, bottom = project(0, -85).y;
  const minimum = Math.max(homeScale, viewportHeight / (bottom - top));
  const scale = clamp(camera.scale, minimum, minimum * 48);
  const halfHeight = viewportHeight / (2 * scale);
  return {
    x: camera.x,
    y: clamp(camera.y, top + halfHeight, bottom - halfHeight),
    scale,
  };
}

export function project(longitude, latitude) {
  const safeLatitude = clamp(latitude, -85, 85) * radians;
  return { x: longitude * radians, y: -Math.log(Math.tan(Math.PI / 4 + safeLatitude / 2)) };
}

export function traceLandRing(landPath, coastPath, ring) {
  let hasDateLineSeam = false;
  ring.forEach(([longitude, latitude], index) => {
    const point = project(longitude, latitude);
    if (index === 0) {
      landPath.moveTo(point.x, point.y);
      coastPath.moveTo(point.x, point.y);
      return;
    }
    landPath.lineTo(point.x, point.y);
    // Natural Earth closes land polygons along ±180°. Those edges are needed
    // for filling, but are not coastlines when adjacent worlds are repeated.
    const previousLongitude = ring[index - 1][0];
    if (Math.abs(longitude) === 180 && longitude === previousLongitude) {
      coastPath.moveTo(point.x, point.y);
      hasDateLineSeam = true;
    } else coastPath.lineTo(point.x, point.y);
  });
  landPath.closePath();
  // Source GeoJSON rings are explicitly closed. Closing a split stroke would
  // reconnect its last subpath across the date-line edge we just omitted.
  if (!hasDateLineSeam) coastPath.closePath();
}

export function unproject(x, y) {
  return { longitude: x / radians, latitude: (2 * Math.atan(Math.exp(-y)) - Math.PI / 2) / radians };
}

export function fitRegion(width, height, region = REGION) {
  const a = project(region.west, region.north);
  const b = project(region.east, region.south);
  const padding = width < 600 ? 22 : 70;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    scale: Math.min(Math.max(1, width - padding * 2) / (b.x - a.x), Math.max(1, height - 150) / (b.y - a.y)),
  };
}

export function worldAt(camera, width, height, x, y) {
  return { x: camera.x + (x - width / 2) / camera.scale, y: camera.y + (y - height / 2) / camera.scale };
}

export function zoomAt(camera, width, height, scale, x, y) {
  const anchor = worldAt(camera, width, height, x, y);
  return { x: anchor.x - (x - width / 2) / scale, y: anchor.y - (y - height / 2) / scale, scale };
}

export function formatCoordinate(longitude, latitude) {
  longitude = normalizeLongitude(longitude);
  const longitudeLabel = `${Math.abs(longitude).toFixed(2)}°${longitude < 0 ? 'W' : 'E'}`;
  const latitudeLabel = `${Math.abs(latitude).toFixed(2)}°${latitude < 0 ? 'S' : 'N'}`;
  return `${longitudeLabel} · ${latitudeLabel}`;
}
