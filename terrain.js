import { wrapLongitude } from './geography.js';

const mercatorY = lat => (1 - Math.asinh(Math.tan(Math.max(-85, Math.min(85, lat)) * Math.PI / 180)) / Math.PI) * .5;
const blendEdge = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export class RegionalTerrain {
  constructor(metadata, values) {
    const { width, height, zoom, tileX, tileY } = metadata;
    if (values.length !== width * height) throw new Error('Regional terrain grid size mismatch');
    Object.assign(this, { width, height, values, scale: 256 * 2 ** zoom, x: tileX * 256, y: tileY * 256 });
  }
  sample(x, y, coarse) {
    x = x * this.scale - this.x - .5; y = y * this.scale - this.y - .5;
    const { width: w, height: h, values: v } = this;
    if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return coarse;
    const ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy, i = iy * w + ix;
    const value = Math.max(0, (v[i] * (1 - a) + v[i + 1] * a) * (1 - b)
      + (v[i + w] * (1 - a) + v[i + w + 1] * a) * b);
    const weight = blendEdge(Math.min(x, y, w - 1 - x, h - 1 - y) / 24);
    return coarse + (value - coarse) * weight;
  }
}

// Offline Mapzen Terrarium DEM, native Web Mercator, signed metre elevations.
// 2048² at the equator is ~20 km: a regional barrier model, not island-scale CFD.
export class Terrain {
  constructor(values, size = 2048, regions = []) {
    if (values.length !== size * size) throw new Error('Terrain grid size mismatch');
    this.values = values; this.size = size; this.regions = regions;
  }
  static async load() {
    const [response, regional, metadata] = await Promise.all(['elevation.i16', 'taiwan-elevation.i16', 'taiwan-elevation.json']
      .map(file => fetch(new URL(`./data/${file}`, import.meta.url))));
    if (![response, regional, metadata].every(r => r.ok)) throw new Error('Elevation data could not be loaded');
    const [globalBytes, localBytes, info] = await Promise.all([response.arrayBuffer(), regional.arrayBuffer(), metadata.json()]);
    return new Terrain(new Int16Array(globalBytes), 2048, [new RegionalTerrain(info, new Int16Array(localBytes))]);
  }
  elevation(lon, lat) {
    const n = this.size, nx = (wrapLongitude(lon) + 180) / 360, ny = mercatorY(lat), x = nx * n - .5;
    const y = Math.max(0, Math.min(n - 1.001, ny * n - .5));
    const ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy;
    const x0 = (ix + n) % n, x1 = (x0 + 1) % n;
    let value = Math.max(0, (this.values[iy * n + x0] * (1 - a) + this.values[iy * n + x1] * a) * (1 - b)
      + (this.values[(iy + 1) * n + x0] * (1 - a) + this.values[(iy + 1) * n + x1] * a) * b);
    for (const region of this.regions) value = region.sample(nx, ny, value);
    return value;
  }
}
