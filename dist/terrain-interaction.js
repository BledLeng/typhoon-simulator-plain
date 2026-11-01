// Directional, finite-time lower-circulation damage. Cloud water is never cut
// out by this model; existing upper cloud can advect across a disrupted core.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const TERRAIN_SECTORS = 16;
export const TERRAIN_BANDS = 12;

function radialLoss(values, sector, radius, r) {
  const p = Math.max(0, r / radius * TERRAIN_BANDS - .5);
  const j = Math.floor(p), a = p - j;
  if (j >= TERRAIN_BANDS) return 0;
  const base = sector * TERRAIN_BANDS;
  return values[base + j] * (1 - a) + (j + 1 < TERRAIN_BANDS ? values[base + j + 1] : 0) * a;
}

// A compact prognostic lee-wake field (16 bearings x 12 radial bands). The
// disturbance is carried downstream by the circulation, not by cursor heading.
// It spreads across neighbouring radii and recovers offshore over finite time.
// This is a reduced-order wake, not a resolved 3-D mountain-wave simulation.
const wakeBuffers = new WeakMap();
const noTerrain = new Array(TERRAIN_SECTORS * TERRAIN_BANDS).fill(0);
function advanceTerrainWake(s, terrain, dt, previousRadius) {
  if (dt <= 0 || (!(terrain.peak > 300) && !(s.terrainWakeStrength > .0001))) return;
  let old = s.terrainWakeBands ||= new Array(TERRAIN_SECTORS * TERRAIN_BANDS).fill(0);
  if (previousRadius && previousRadius !== s.terrainRadius) {
    old = s.terrainWakeBands = old.map((_, i) => radialLoss(old, Math.floor(i / TERRAIN_BANDS), previousRadius,
      (i % TERRAIN_BANDS + .5) * s.terrainRadius / TERRAIN_BANDS));
  }
  const next = wakeBuffers.get(s) || new Array(old.length), dr = s.terrainRadius / TERRAIN_BANDS;
  const source = terrain.bands || noTerrain;
  const rmw = terrain.rmw || s.coreRadius || Math.max(20, Math.min(140, s.radius * .14));
  const decay = Math.exp(-dt / 3), feed = 1 - Math.exp(-dt), mix = Math.min(.16, 180 * dt / (dr * dr));
  const sign = s.lat < 0 ? -1 : 1;
  let maximum = 0;
  for (let band = 0; band < TERRAIN_BANDS; band++) {
    const r = (band + .5) * dr;
    const wind = Math.max(0, s.wind || 0) * 3.6 * Math.min(r / rmw, (rmw / r) ** .65) * (s.organization || 0);
    const travel = sign * wind * dt / (2 * Math.PI * r) * TERRAIN_SECTORS;
    for (let sector = 0; sector < TERRAIN_SECTORS; sector++) {
      const from = ((sector + travel) % TERRAIN_SECTORS + TERRAIN_SECTORS) % TERRAIN_SECTORS;
      const j = Math.floor(from), a = from - j;
      const j0 = j * TERRAIN_BANDS, j1 = ((j + 1) % TERRAIN_SECTORS) * TERRAIN_BANDS;
      const inner = Math.max(0, band - 1), outer = Math.min(TERRAIN_BANDS - 1, band + 1);
      let advected = old[j0 + band] * (1 - a) + old[j1 + band] * a;
      const neighbours = (old[j0 + inner] + old[j0 + outer]) * (1 - a) + (old[j1 + inner] + old[j1 + outer]) * a;
      advected += mix * (neighbours - 2 * advected);
      const i = sector * TERRAIN_BANDS + band, target = clamp(source[i], 0, 1);
      const value = clamp(advected * decay + Math.max(0, target - advected) * feed, 0, 1);
      next[i] = value;
      maximum = Math.max(maximum, value);
    }
  }
  wakeBuffers.set(s, old);
  s.terrainWakeBands = next;
  s.terrainWakeStrength = maximum;
}

function bandDamage(s, index) {
  const direct = s.terrainBands[index], wake = s.terrainWakeBands?.[index] || 0;
  return 1 - (1 - direct) * (1 - .7 * wake);
}

export function applyTerrainDisruption(s, terrain, dt) {
  s.terrainRevision = (s.terrainRevision || 0) + 1;
  const barrier = clamp(terrain.blocking, 0, 1);
  s.terrainExposure = (s.terrainExposure || 0) + (barrier - (s.terrainExposure || 0)) * (1 - Math.exp(-dt / 2));
  s.terrainHeight = terrain.peak;
  const previousRadius = s.terrainRadius;
  s.terrainRadius = terrain.radius ?? s.terrainRadius ?? 120;
  const memory = s.terrainSectors ||= new Array(TERRAIN_SECTORS).fill(0);
  s.terrainAsymmetry = 0;
  for (let i = 0; i < memory.length; i++) {
    const target = clamp(terrain.sectors?.[i] ?? barrier, 0, 1);
    // Damage develops over hours and heals more slowly offshore. Keep sectors
    // geographically fixed, independent of hand-guided storm heading.
    memory[i] += (target - memory[i]) * (1 - Math.exp(-dt / (target > memory[i] ? 1.5 : 8)));
    s.terrainAsymmetry = Math.max(s.terrainAsymmetry, memory[i]);
  }
  if (terrain.bands) {
    let bands = s.terrainBands ||= new Array(TERRAIN_SECTORS * TERRAIN_BANDS).fill(0);
    if (previousRadius && previousRadius !== s.terrainRadius) {
      // Regrid damage in physical km when the circulation changes size. Never
      // stretch a damaged outer rainband into an otherwise intact eyewall.
      bands = s.terrainBands = bands.map((_, i) => radialLoss(bands, Math.floor(i / TERRAIN_BANDS),
        previousRadius, (i % TERRAIN_BANDS + .5) * s.terrainRadius / TERRAIN_BANDS));
    }
    s.terrainAsymmetry = 0;
    for (let i = 0; i < bands.length; i++) {
      const target = clamp(terrain.bands[i], 0, 1);
      bands[i] += (target - bands[i]) * (1 - Math.exp(-dt / (target > bands[i] ? 1.25 : 8)));
      s.terrainAsymmetry = Math.max(s.terrainAsymmetry, bands[i]);
    }
  } else if (s.terrainBands) {
    // Missing/zero terrain remains a continuous recovery, not an instant reset.
    for (let i = 0; i < s.terrainBands.length; i++) s.terrainBands[i] *= Math.exp(-dt / 8);
    s.terrainAsymmetry = Math.max(...s.terrainBands);
  }
  advanceTerrainWake(s, terrain, dt, previousRadius);
  s.terrainAsymmetry = Math.max(s.terrainAsymmetry, .7 * (s.terrainWakeStrength || 0));
  const damage = s.terrainExposure * dt;
  s.organization *= Math.exp(-damage / 10);
  s.wind *= Math.exp(-damage / 18);
  s.eye *= Math.exp(-damage / 3);
  s.warmCore *= Math.exp(-damage / 12);
}

const reachCache = new WeakMap();
// Terrain can interrupt an outer branch even when the nominal outer boundary
// lies offshore beyond the ridge. Sampling damage ONLY at that boundary made
// the outer circulation look perfectly circular after crossing a mountain.
// Diagnose each sector's connected reach through the radial damage profile.
// The same reach tapers the numerical wind AND draws the circulation outline.
export function terrainCirculationRadius(s, bearing, nominal = s.radius) {
  if (!(s.terrainAsymmetry > .0001) || !s.terrainSectors) return nominal;
  let cached = reachCache.get(s);
  if (!cached || cached.revision !== s.terrainRevision || cached.nominal !== nominal
    || cached.bands !== s.terrainBands || cached.asymmetry !== s.terrainAsymmetry) {
    const reach = new Float64Array(TERRAIN_SECTORS), terrainRadius = s.terrainRadius || 120;
    reach.fill(nominal);
    for (let sector = 0; sector < TERRAIN_SECTORS; sector++) {
      if (s.terrainBands) {
        for (let band = 0; band < TERRAIN_BANDS; band++) {
          const r = (band + .5) * terrainRadius / TERRAIN_BANDS;
          if (r >= nominal) break;
          const loss = clamp(bandDamage(s, sector * TERRAIN_BANDS + band), 0, 1);
          reach[sector] = Math.min(reach[sector], r + (nominal - r) * (1 - .85 * loss));
        }
      } else reach[sector] *= 1 - .65 * clamp(s.terrainSectors[sector], 0, 1);
    }
    cached = { revision:s.terrainRevision, nominal, bands:s.terrainBands, asymmetry:s.terrainAsymmetry, reach };
    reachCache.set(s, cached);
  }
  const phase = ((bearing / (2 * Math.PI) % 1 + 1) % 1) * TERRAIN_SECTORS;
  const i = Math.floor(phase), a = phase - i;
  return cached.reach[i] * (1 - a) + cached.reach[(i + 1) % TERRAIN_SECTORS] * a;
}

// Bearing is radians clockwise from north; r is km from the cyclone centre.
export function terrainWindFactor(s, bearing, r) {
  if (!(s.terrainAsymmetry > .0001) || !s.terrainSectors) return 1;
  const n = s.terrainSectors.length;
  const phase = ((bearing / (2 * Math.PI) % 1 + 1) % 1) * n;
  const i = Math.floor(phase), t = phase - i;
  if (s.terrainBands) {
    const radius = Math.max(1, s.terrainRadius || 120);
    let loss = radialLoss(s.terrainBands, i, radius, r) * (1 - t)
      + radialLoss(s.terrainBands, (i + 1) % n, radius, r) * t;
    if (s.terrainWakeBands) {
      const wake = radialLoss(s.terrainWakeBands, i, radius, r) * (1 - t)
        + radialLoss(s.terrainWakeBands, (i + 1) % n, radius, r) * t;
      loss = 1 - (1 - loss) * (1 - .7 * wake);
    }
    if (r < radius / (TERRAIN_BANDS * 2)) {
      let center = 0;
      for (let sector = 0; sector < n; sector++) center += bandDamage(s, sector * TERRAIN_BANDS) / n;
      const radial = r / (radius / (TERRAIN_BANDS * 2));
      loss = center * (1 - radial) + loss * radial;
    }
    return 1 - .85 * clamp(loss, 0, 1);
  }
  const loss = s.terrainSectors[i] * (1 - t) + s.terrainSectors[(i + 1) % n] * t;
  const radial = 1 / (1 + (r / Math.max(40, s.terrainRadius || 120)) ** 4);
  return 1 - .65 * loss * radial;
}
