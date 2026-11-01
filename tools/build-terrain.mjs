import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = new URL('../', import.meta.url), size = 2048, bytes = Buffer.alloc(size * size * 2);
const cache = new URL('.cache/terrain-tiles/', root);
await fs.mkdir(cache, { recursive: true });
let next = 0;
async function worker() {
  while (next < 64) {
    const id = next++, x = id % 8, y = Math.floor(id / 8), file = new URL(`${x}-${y}.png`, cache);
    let png;
    try { png = await fs.readFile(file); } catch {
      const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/3/${x}/${y}.png`);
      if (!response.ok) throw new Error(`DEM ${x}/${y}: ${response.status}`);
      png = Buffer.from(await response.arrayBuffer()); await fs.writeFile(file, png);
    }
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== 256 || info.height !== 256 || info.channels !== 3) throw new Error('Unexpected DEM tile');
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const p = (j * 256 + i) * 3;
      const value = Math.round(data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768);
      bytes.writeInt16LE(Math.max(-32768, Math.min(32767, value)), ((y * 256 + j) * size + x * 256 + i) * 2);
    }
    console.log(`Terrain ${id + 1}/64`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
await fs.writeFile(new URL('dist/data/elevation.i16', root), bytes);
await fs.writeFile(new URL('dist/data/elevation.json', root), JSON.stringify({
  size, format: 'int16-le metres', projection: 'EPSG:3857', zoom: 3,
  source: 'https://registry.opendata.aws/terrain-tiles/',
  attribution: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  limitations: 'Approx. 20 km at equator; regional barriers only. Below 85°S / above 85°N not resolved.'
}, null, 2) + '\n');
