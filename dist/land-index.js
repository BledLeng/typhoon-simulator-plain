import { project, normalizeLongitude } from './map-math.js';

// Exact even/odd coastline queries, indexed by Mercator scanline. A point
// test must not walk the complete world Path2D for every ocean/terrain sample.
// This is a spatial index of the original segments, NOT a lower-resolution mask.
export class LandIndex {
  constructor(data, bandCount = 512) {
    this.top = project(0, 85).y;
    this.bottom = project(0, -85).y;
    this.bandScale = bandCount / (this.bottom - this.top);
    this.bands = Array.from({ length: bandCount }, () => []);
    const segments = [];
    const features = data.type === 'FeatureCollection' ? data.features : [{ geometry: data }];
    for (const { geometry } of features) {
      const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
        : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
      for (const polygon of polygons) for (const ring of polygon) {
        if (ring.length < 3) continue;
        let a = project(...ring.at(-1));
        for (const coordinate of ring) {
          const b = project(...coordinate);
          if (a.x !== b.x || a.y !== b.y) {
            const id = segments.length;
            segments.push(a.x, a.y, b.x, b.y);
            const first = this.band(Math.min(a.y, b.y)), last = this.band(Math.max(a.y, b.y));
            for (let row = first; row <= last; row++) this.bands[row].push(id);
          }
          a = b;
        }
      }
    }
    this.segments = Float64Array.from(segments);
    this.bands = this.bands.map(row => Uint32Array.from(row));
  }

  band(y) {
    return Math.max(0, Math.min(this.bands.length - 1, Math.floor((y - this.top) * this.bandScale)));
  }

  contains(longitude, latitude) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
    const { x, y } = project(normalizeLongitude(longitude), latitude);
    const edges = this.segments;
    let inside = false;
    for (const i of this.bands[this.band(y)]) {
      const ax = edges[i], ay = edges[i + 1], bx = edges[i + 2], by = edges[i + 3];
      // Canvas treats a point on a path boundary as inside, including holes.
      if (y >= Math.min(ay, by) && y <= Math.max(ay, by)
          && x >= Math.min(ax, bx) && x <= Math.max(ax, bx)
          && Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) < 1e-14) return true;
      if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside;
    }
    return inside;
  }
}
