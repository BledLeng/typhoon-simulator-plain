// Shared spherical-domain contract. Longitudes are periodic, never a kill boundary.
export const WORLD = Object.freeze({ west: -180, east: 180, south: -85, north: 85 });
export const wrapLongitude = lon => ((lon + 180) % 360 + 360) % 360 - 180;
export const longitudeDelta = (a, b) => wrapLongitude(a - b);
export const isMediterranean = (lon, lat) => {
  const x = wrapLongitude(lon);
  return x >= -6 && x <= 36.5 && lat >= 30 && lat <= 46;
};
export const isGlobalOceanCandidate = (lon, lat, land) =>
  Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 85 && !land;
