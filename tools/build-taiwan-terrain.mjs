// Higher-resolution, bounded regional DEM; no hand-painted mountain peaks.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = new URL('../', import.meta.url), zoom = 7, tileX = 106, tileY = 54;
const columns = 2, rows = 3, width = columns * 256, height = rows * 256;
const bytes = Buffer.alloc(width * height * 2), hashes = [];
const cache = new URL('data-source/taiwan-terrain/', root);
await fs.mkdir(cache, { recursive: true });
for (let dy = 0; dy < rows; dy++) for (let dx = 0; dx < columns; dx++) {
  const x = tileX + dx, y = tileY + dy, file = new URL(`${zoom}-${x}-${y}.png`, cache);
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`;
  let png;
  try { png = await fs.readFile(file); } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`DEM ${url}: ${response.status}`);
    png = Buffer.from(await response.arrayBuffer()); await fs.writeFile(file, png);
  }
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 256 || info.height !== 256 || info.channels !== 3) throw new Error('Unexpected DEM tile');
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const p = (j * 256 + i) * 3;
    const elevation = Math.round(data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768);
    bytes.writeInt16LE(Math.max(-32768, Math.min(32767, elevation)), ((dy * 256 + j) * width + dx * 256 + i) * 2);
  }
  hashes.push({ url, sha256: createHash('sha256').update(png).digest('hex') });
  console.log(`Terrain ${hashes.length}/${columns * rows}`);
}
await fs.writeFile(new URL('dist/data/taiwan-elevation.i16', root), bytes);
await fs.writeFile(new URL('dist/data/taiwan-elevation.json', root), JSON.stringify({
  width, height, zoom, tileX, tileY, format: 'int16-le metres', projection: 'EPSG:3857',
  source: 'https://registry.opendata.aws/terrain-tiles/',
  attribution: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  accessed: '2026-10-31', sha256: createHash('sha256').update(bytes).digest('hex'), tiles: hashes,
  limitations: 'Approximately 1.1 km near Taiwan. Regional topographic forcing, not summit-scale or 3-D flow resolution.'
}, null, 2) + '\n');
