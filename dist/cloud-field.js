import { random, clamp, smooth, sampleEnvironment, radiusOfMaximumWind } from './simulation.js?v=eye-42';
import { bandAnomaly } from './eye-morphology.js?v=eye-42';
import { project, unproject } from './map-math.js';
import { WORLD, longitudeDelta, isMediterranean } from './geography.js';
import { terrainWindFactor, terrainCirculationRadius } from './terrain-interaction.js';
import { surfaceVaporSupply } from './surface-flux.js';
import { flaq_marineTarget, flaq_condensation, flaq_reevaporation, flaq_rainbandExchange } from './marine.generated.js';
import { cloudProductPixels, isCloudProduct } from './cloud-products.js?v=eye-low-44';
import { longitudeNoiseAxis, addNoiseRow } from './noise-grid.js';
import { pressureRange, pressureSurface } from './pressure-field.js';
import { makeCloudKernel } from './moist-kernel-v2.js';

export const FIELD_BOUNDS = WORLD;
const DEG = Math.PI / 180;
const saturation = t => 3.8 * Math.exp(.059 * t);
// Each water bin spans less than one alpha level. Compare with the exact next
// half-integer boundary to reproduce round(255 * (1 - exp(-2.6 * water))).
const alphaBins = Uint8Array.from({length:4097}, (_, i) => Math.round(255 * -Math.expm1(-2.6 * i / 1024)));
const alphaBoundary = Float64Array.from({length:256}, (_, a) => a === 255 ? Infinity : -Math.log1p(-(a + .5) / 255) / 2.6);
const littleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
const lightRGB = Uint32Array.from({length:256}, (_, l) => l | Math.min(255, l + 3) << 8 | Math.min(255, l + 6) << 16);
export function cloudOpacity(water) {
  if (water >= 4) return 255;
  const alpha = alphaBins[Math.max(0, water * 1024) | 0];
  return alpha + (water >= alphaBoundary[alpha]);
}

// Reduced-order moist layer, not 3-D NWP. Prognostic quantities are g/kg and °C;
// flow is km/h. Condensate itself supplies rendered alpha (no rotating sprites).
export class MoistAtmosphere {
  constructor(seed, width = 640, height = 448, land = null, bounds = FIELD_BOUNDS) {
    this.width = width; this.height = height; this.seed = seed; this.time = 0;
    this.bounds = bounds;
    this.periodic = bounds.east - bounds.west >= 359.99;
    this.n = width * height; this.land = land || new Uint8Array(this.n);
    this.top = project(0, bounds.north).y;
    this.bottom = project(0, bounds.south).y;
    this.dx = (bounds.east - bounds.west) * DEG / width;
    this.dy = (this.bottom - this.top) / height;
    this.lon = Float32Array.from({ length: width }, (_, x) => bounds.west + (x + .5) * this.dx / DEG);
    this.lat = Float32Array.from({ length: height }, (_, y) => unproject(0, this.top + (y + .5) * this.dy).latitude);
    this.kmx = Float32Array.from(this.lat, lat => 6371 * Math.cos(lat * DEG) * this.dx);
    this.kmy = Float32Array.from(this.lat, lat => 6371 * Math.cos(lat * DEG) * this.dy);
    // Resolution must not choose a different initial sky. Keep the original
    // 512 × 384 seed pattern anchored to geographic coordinates at every LOD.
    const globalTop = project(0, 76).y, globalBottom = project(0, -50).y;
    this.seedY = Float64Array.from(this.lat, lat => (project(0, lat).y - globalTop) / (globalBottom - globalTop) * 384 - .5);
    for (const name of ['vapor', 'water', 'temperature', 'cold', 'u', 'v', 'lift', 'sink', 'dryMix', 'dryVapor', 'coreSupport', 'inflowAscent']) this[name] = new Float32Array(this.n);
    this.next = Array.from({ length: 4 }, () => new Float32Array(this.n));
    this.envFields = {}; this.envTime = -Infinity; this.injected = new Set(); this.initialized = false;
    this.forcingNoise = this.noiseFactory();
    this.seaCooling = new Float32Array(this.n);
    this.soilWater = new Float32Array(this.n); this.soilHeat = new Float32Array(this.n);
    this.convection = new Float32Array(this.n);
    this.kernel = makeCloudKernel(this.n, this.height);
  }
  noiseFactory() {
    const rng = random(this.seed), values = Float32Array.from({ length: 4096 }, rng);
    this.noiseValues = values;
    return (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      let a = x - ix, b = y - iy; a *= a * (3 - 2 * a); b *= b * (3 - 2 * b);
      const x0 = ix & 63, x1 = (ix + 1) & 63, y0 = (iy & 63) * 64, y1 = ((iy + 1) & 63) * 64;
      return (values[y0 + x0] * (1 - a) + values[y0 + x1] * a) * (1 - b)
        + (values[y1 + x0] * (1 - a) + values[y1 + x1] * a) * b;
    };
  }
  relocate(bounds) {
    // Move the numerical mesh, not a cloud texture. CloudDetails remaps its
    // prognostic state from the old geographical coordinates immediately after.
    this.bounds = bounds;
    this.top = project(0, bounds.north).y; this.bottom = project(0, bounds.south).y;
    this.dx = (bounds.east - bounds.west) * DEG / this.width;
    this.dy = (this.bottom - this.top) / this.height;
    for (let x = 0; x < this.width; x++) this.lon[x] = bounds.west + (x + .5) * this.dx / DEG;
    for (let y = 0; y < this.height; y++) {
      this.lat[y] = unproject(0, this.top + (y + .5) * this.dy).latitude;
      this.kmx[y] = 6371 * Math.cos(this.lat[y] * DEG) * this.dx;
      this.kmy[y] = 6371 * Math.cos(this.lat[y] * DEG) * this.dy;
    }
    this.envTime = -Infinity; this.lightTime = -Infinity;
    this.sampleMaps = null; this.seamSource = null;
  }
  refreshEnvironment(env, hours) {
    this.seasonDay=env.seasonDay;
    if (hours - this.envTime < 3 && this.initialized && this.envRevision === env.revision) return;
    this.envTime = hours;
    this.envRevision = env.revision;
    const names = ['sst', 'humidity', 'shear', 'u', 'v', 'temperature', 'high', 'trough', 'itcz', 'cold', 'ohc', 'depth26', 'pressure', 'shearAngle', 'front'];
    for (const name of names) this.envFields[name] ||= new Float32Array(this.n);
    for (const name of ['upperU', 'upperV', 'targetVapor', 'shearCos', 'shearSin', 'convectiveActivity']) this.envFields[name] ||= new Float32Array(this.n);
    // These coefficients are functions of the ambient field only. Keep double
    // precision so caching does not change the thermodynamic equations.
    for (const name of ['thermalHumidity', 'ambientLift', 'activityLift', 'shearContrast', 'activitySector', 'surfaceSaturation']) this.envFields[name] ||= new Float64Array(this.n);
    const stride = 8, gw = Math.ceil(this.width / stride) + 1, gh = Math.ceil(this.height / stride) + 1;
    const lattice = names.map(() => new Float64Array(gw * gh));
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const column = this.periodic ? (x * stride) % this.width : Math.min(x * stride, this.width - 1);
      const sample = sampleEnvironment(env, this.lon[column], this.lat[Math.min(y * stride, this.height - 1)], hours);
      for (let channel = 0; channel < names.length; channel++) lattice[channel][y * gw + x] = sample[names[channel]];
    }
    // Horizontal lattice interpolation repeats identically for eight output
    // rows. Calculate it once in Float64, then interpolate vertically. This
    // preserves the exact arithmetic/rounding and all original grid samples.
    const rows = this.environmentRows ||= new Float64Array(gh * this.width);
    for (let channel = 0; channel < names.length; channel++) {
      const source = lattice[channel], output = this.envFields[names[channel]];
      for (let y = 0; y < gh; y++) for (let x = 0; x < this.width; x++) {
        const gx = Math.floor(x / stride), a = x / stride - gx, k = y * gw + gx;
        rows[y * this.width + x] = source[k] * (1 - a) + source[k + 1] * a;
      }
      for (let y = 0; y < this.height; y++) {
        const gy = Math.floor(y / stride), b = y / stride - gy, row = gy * this.width;
        for (let x = 0; x < this.width; x++) {
          output[y * this.width + x] = rows[row + x] * (1 - b) + rows[row + this.width + x] * b;
        }
      }
    }
    const axes = [[.28, -.025], [.28 * 3.1, -.025 * 3.1], [1.9, -.11], [.63, -.037], [2.8,-.085]]
      .map(([frequency, drift]) => longitudeNoiseAxis(this.lon, frequency, hours * drift));
    const [anomalies, activities, cells] = this.forcingRows ||= Array.from({length:3},()=>new Float64Array(this.width));
    for (let y = 0; y < this.height; y++) {
      const ny = this.lat[y] * .32;
      addNoiseRow(this.noiseValues, axes[0], ny, .65, anomalies, true);
      addNoiseRow(this.noiseValues, axes[1], ny * 3.1, .35, anomalies, false);
      addNoiseRow(this.noiseValues, axes[2], this.lat[y] * 1.9, .55, activities, true);
      addNoiseRow(this.noiseValues, axes[3], this.lat[y] * .63, .45, activities, false);
      // Moisture variability at two mesoscale lengths; only force wavelengths
      // the numerical grid resolves. Thin fronts can break into moist cells
      // without sprinkling static noise on every cloud or on a clear sky.
      const resolved=1-smooth(12,42,Math.max(this.kmx[y],this.kmy[y]));
      if(resolved>0)addNoiseRow(this.noiseValues,axes[4],this.lat[y]*2.4+hours*.03,1,cells,true);
      for (let x = 0; x < this.width; x++) {
      const i = y * this.width + x;
      // Seeded mesoscale forcing, applied to thermodynamic state, not display noise.
      // Advancing the smooth forcing in physical coordinates supplies unresolved
      // humidity/instability variability without resetting existing condensate.
      const anomaly = anomalies[x]+((activities[x]-.5)*.22+(cells[x]-.5)*.30)*resolved;
      const e = this.envFields;
      // A trough is a wind feature, not an instruction to saturate a strip.
      // Keep its dry breaks. Diagnose the moist, converging sectors from the
      // background flow before applying subgrid thermals (not from a sprite).
      const trough = e.trough[i];
      const belt = !this.land[i] && trough > .15 ? smooth(.15,.90,trough) : 0;
      const marine = belt*belt*smooth(23,28,e.sst[i]);
      let feed = 0;
      if (marine > 0) {
        const left = x ? i-1 : this.periodic ? i+this.width-1 : i;
        const right = x+1<this.width ? i+1 : this.periodic ? i-this.width+1 : i;
        const north = y ? i-this.width : i, south = y+1<this.height ? i+this.width : i;
        // u/v: km/h. Solver rows run southward; positive v points north.
        const convergence = (e.u[left]-e.u[right])/(2*this.kmx[y])
          + (e.v[south]-e.v[north])/(2*this.kmy[y]);
        const supply = smooth(62,87,e.humidity[i]);
        // Subgrid moisture anomalies favour clusters, not every longitude
        // on the trough axis. They cannot initiate a plume without supply.
        feed = Math.min(1,supply*(.32+.68*smooth(-.001,.008,convergence))
          *(.52+.85*smooth(.31,.68,anomaly)));
      }
      const dryBreak = marine*(1-feed);
      e.humidity[i] = clamp(e.humidity[i] - 16*dryBreak + 4*marine*feed
        + (anomaly-.45)*65*(1-.42*dryBreak), 20, 103);
      this.envFields.temperature[i] += (anomaly - .5) * 3;
      // Subgrid instability modulates physical uplift, never image alpha. Its
      // geographical scale is shared by parent/nests; advection then organizes
      // the resulting condensate into bands. No prescribed rotating spiral.
      this.envFields.convectiveActivity[i] = activities[x];
      this.envFields.shearCos[i] = Math.cos(this.envFields.shearAngle[i]);
      this.envFields.shearSin[i] = Math.sin(this.envFields.shearAngle[i]);
      this.envFields.upperU[i] = this.envFields.shearCos[i] * this.envFields.shear[i] * 1.2;
      this.envFields.upperV[i] = this.envFields.shearSin[i] * this.envFields.shear[i] * 1.2;
      this.envFields.targetVapor[i] = saturation(this.envFields.temperature[i]) * this.envFields.humidity[i] / 100;
      this.envFields.thermalHumidity[i] = smooth(65, 98, this.envFields.humidity[i]);
      // Shallow convergence can moisten a clear column. Most additional lift
      // in a fed sector is conditional on local RH and surface buoyancy in
      // step(); a warm dry grid cell cannot jump straight to deep convection.
      // The ITCZ and trough can overlap. Do not double-count broad ascent
      // inside a poorly supplied break; compensating subsidence warms it.
      e.ambientLift[i] = (trough*(1-marine*(.90-.65*feed)) + e.itcz[i]*(1-.55*dryBreak))*.07
        - e.high[i]*.06 - .035*dryBreak;
      e.activityLift[i] = .035 + .17*e.convectiveActivity[i] + .22*marine*feed;
      this.envFields.shearContrast[i] = .55 * smooth(3, 22, this.envFields.shear[i]);
      this.envFields.activitySector[i] = .18 + .82 * smooth(.25, .75, this.envFields.convectiveActivity[i]);
      this.envFields.surfaceSaturation[i] = saturation(this.envFields.sst[i]);
      }
    }
    if (this.initialized) return;
    const e = this.envFields, seedRow = new Float64Array(this.width);
    const seedAxes = [38, 12, 3].map(scale => longitudeNoiseAxis(this.lon, 512 / 280 / scale, (-40 * 512 / 280 - .5) / scale));
    for (let y = 0; y < this.height; y++) {
      addNoiseRow(this.noiseValues, seedAxes[0], this.seedY[y] / 28, .56, seedRow, true);
      addNoiseRow(this.noiseValues, seedAxes[1], this.seedY[y] / 11, .27, seedRow, false);
      addNoiseRow(this.noiseValues, seedAxes[2], this.seedY[y] / 3, .17, seedRow, false);
      for (let x = 0; x < this.width; x++) {
      const i = y * this.width + x;
      const n = seedRow[x];
      this.temperature[i] = e.temperature[i] + (n - .5) * 5;
      const rh = clamp(e.humidity[i] / 100 + (n - .45) * .9, .2, 1.18);
      this.vapor[i] = saturation(this.temperature[i]) * Math.min(1, rh);
      this.water[i] = Math.max(0, rh - .86) * 3.5;
      this.soilWater[i] = this.land[i] ? clamp((e.humidity[i] - 40) / 100, .05, .6) : 0;
      this.soilHeat[i] = e.temperature[i];
      }
    }
    this.initialized = true;
  }
  point(lon, lat) {
    const center = (this.bounds.west + this.bounds.east) * .5;
    const local = center + longitudeDelta(lon, center);
    return { x: (local - this.bounds.west) * DEG / this.dx - .5, y: (project(0, lat).y - this.top) / this.dy - .5 };
  }
  setOcean(ocean) {
    if (!ocean?.cells.length && !this.hasColdWake) return;
    this.hasColdWake = !!ocean?.cells.length; this.seaCooling.fill(0);
    if (!this.hasColdWake) return;
    const grid = new Float32Array(ocean.width * ocean.height);
    const activeRows = new Uint8Array(ocean.height);
    for (const [i, cooling] of ocean.cells) {
      grid[i] = cooling; activeRows[Math.floor(i/ocean.width)] = 1;
    }
    // Longitude indices and weights are shared by every row; latitude bounds
    // are shared by every column. Never repeat wrap/modulo for four neighbours
    // at every cell, especially on a global cold-wake update.
    const columns = Array.from(this.lon, lon => {
      const xx = (lon - ocean.west) / ocean.step - .5, ix = Math.floor(xx);
      return [((ix % ocean.width) + ocean.width) % ocean.width,
        (((ix + 1) % ocean.width) + ocean.width) % ocean.width, xx - ix];
    });
    for (let y = 0; y < this.height; y++) {
      const yy = (this.lat[y] - ocean.south) / ocean.step - .5, iy = Math.floor(yy), b = yy - iy;
      const row0 = iy >= 0 && iy < ocean.height ? iy * ocean.width : -1;
      const row1 = iy + 1 >= 0 && iy + 1 < ocean.height ? (iy + 1) * ocean.width : -1;
      if (!activeRows[iy] && !activeRows[iy+1]) continue;
      for (let x = 0; x < this.width; x++) {
        const [left, right, a] = columns[x];
        this.seaCooling[y * this.width + x] = ((row0 < 0 ? 0 : grid[row0 + left]) * (1 - a)
          + (row0 < 0 ? 0 : grid[row0 + right]) * a) * (1 - b)
          + ((row1 < 0 ? 0 : grid[row1 + left]) * (1 - a) + (row1 < 0 ? 0 : grid[row1 + right]) * a) * b;
      }
    }
  }
  sample(array, x, y) {
    if (this.periodic) {
      const w = this.width;
      if (x < 0 || x >= w) x -= Math.floor(x / w) * w;
      y = clamp(y, 0, this.height - 1.001);
      const ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy, j = ix === w - 1 ? 0 : ix + 1;
      return (array[iy * w + ix] * (1 - a) + array[iy * w + j] * a) * (1 - b)
        + (array[(iy + 1) * w + ix] * (1 - a) + array[(iy + 1) * w + j] * a) * b;
    }
    x = clamp(x, 0, this.width - 1.001); y = clamp(y, 0, this.height - 1.001);
    const ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy, i = iy * this.width + ix;
    return (array[i] * (1 - a) + array[i + 1] * a) * (1 - b)
      + (array[i + this.width] * (1 - a) + array[i + this.width + 1] * a) * b;
  }
  forStorm(s, radius, visit, touched = null) {
    const p = this.point(s.lon, s.lat), iy = clamp(Math.round(p.y), 0, this.height - 1);
    const rx = radius / this.kmx[iy], ry = radius / this.kmy[iy];
    const firstX = this.periodic ? Math.max(Math.floor(p.x-rx),Math.ceil(p.x-this.width/2)) : Math.max(1,Math.floor(p.x-rx));
    const lastX = this.periodic ? Math.min(Math.ceil(p.x+rx),firstX+this.width-1) : Math.min(this.width-2,Math.ceil(p.x+rx));
    const radiusSquared = radius * radius, w = this.width;
    for (let y = Math.max(1, Math.floor(p.y - ry)); y <= Math.min(this.height - 2, Math.ceil(p.y + ry)); y++) {
      const dy = (p.y - y) * this.kmy[y], dySquared = dy * dy, kmx = this.kmx[y], row = y * w;
      if (dySquared > radiusSquared) continue;
      if (touched && lastX >= firstX) {
        const crosses = this.periodic && (firstX < 1 || lastX >= w-1);
        touched.lo[y] = Math.min(touched.lo[y], crosses ? 0 : firstX);
        touched.hi[y] = Math.max(touched.hi[y], crosses ? w-1 : lastX);
      }
      for (let x = firstX; x <= lastX; x++) {
        const dx = (x - p.x) * kmx, squared = dx * dx + dySquared;
        if (squared > radiusSquared) continue;
        const column = x >= 0 && x < w ? x : ((x % w) + w) % w;
        visit(row + column, dx, dy, Math.sqrt(squared));
      }
    }
  }
  inject(systems) {
    if (this.injected.size > 512) this.injected = new Set(systems.filter(s => this.injected.has(s.id)).map(s => s.id));
    for (const s of systems) {
      if (this.injected.has(s.id)) continue;
      this.injected.add(s.id);
      if (!s.injected) continue;
      this.injectionRevision = (this.injectionRevision || 0) + 1;
      // A manually seeded cloud is a moist complex, not a round storm stamp.
      // Different thermals share a broad vapour envelope; thereafter the
      // ordinary moist solver alone condenses, transports and rains them out.
      const cells=[];
      if(s.kind==='cloud'){
        const rng=random((s.seed ?? (this.seed^Math.imul(s.id,2654435761)))>>>0);
        const phase=rng()*2*Math.PI, cs=Math.cos(phase), sn=Math.sin(phase);
        for(let k=0;k<6;k++){
          const a=(rng()-.5)*1.65,b=(rng()-.5)*.68, width=.22+rng()*.28;
          cells.push([(a*cs-b*sn)*s.radius,(a*sn+b*cs)*s.radius,1/(s.radius*width)**2]);
        }
      }
      this.forStorm(s, s.radius * 2, (i, dx, dy, r) => {
        const amount = Math.exp(-r * r / (s.radius * s.radius * .6));
        let thermal=amount;
        if(cells.length){
          thermal=0;
          for(const [cx,cy,inv] of cells)thermal+=Math.exp(-((dx-cx)**2+(dy-cy)**2)*inv);
          thermal*=.66;
        }
        this.vapor[i] += 1.4*amount + .8*thermal; this.water[i] += thermal*.7; this.temperature[i] -= thermal;
      });
    }
  }
  flow(systems, reuseGeometry = false) {
    const e = this.envFields;
    this.hasTransportWind = true;
    if (!this.periodic && reuseGeometry && this.flowGeometry?.environment === this.envTime) {
      const g = this.flowGeometry;
      this.u.set(g.u); this.v.set(g.v); this.dryMix.set(g.dryMix); this.dryVapor.set(g.dryVapor);
      this.lift.fill(0); this.sink.set(g.sink);
      for (let i = 0; i < this.n; i++) {
        if (g.moistLift[i] === 0 && g.moistSink[i] === 0) continue;
        const rh = clamp(this.vapor[i] / saturation(this.temperature[i]), 0, 1.05);
        this.lift[i] = g.moistLift[i] * smooth(.62, 1, rh) / (1 + this.cold[i] * .7);
        this.sink[i] = g.sink[i] + g.moistSink[i] * smooth(.72, 1, rh);
      }
      this.coldPoolFlow();
      return;
    }
    // A nested mesh takes four short transport steps for every parent step.
    // Vortex geometry is unchanged across them; moisture and cold pools are NOT.
    const geometry = this.periodic ? null : (this.flowGeometry ||= {
      ...Object.fromEntries(['u', 'v', 'dryMix', 'dryVapor', 'sink', 'moistLift', 'moistSink'].map(key => [key, new Float64Array(this.n)])),
    });
    if (geometry) { geometry.sink.fill(0); geometry.moistLift.fill(0); geometry.moistSink.fill(0); }
    this.u.set(e.u); this.v.set(e.v); this.lift.fill(0); this.sink.fill(0);
    this.dryMix.fill(0); this.dryVapor.fill(0);
    this.coreSupport.fill(0);
    this.inflowAscent.fill(0);
    const touched = this.periodic ? (this.flowRows ||= {
      lo:new Int32Array(this.height), hi:new Int32Array(this.height)
    }) : null;
    if (touched) { touched.lo.fill(this.width); touched.hi.fill(-1); }
    let hasCyclone = false;
    for (const s of systems) {
      if (s.kind === 'cloud' || s.wind < 3) continue;
      const anti = s.kind === 'anticyclone', extra = s.kind === 'extratropical';
      hasCyclone ||= !anti;
      const transition = s.transition ?? (extra ? 1 : 0);
      const hybrid = s.subtropicality ?? Number(s.kind === 'subtropical');
      const tropicalCore = radiusOfMaximumWind(s);
      const rmw = anti ? s.radius * .4 : tropicalCore + (s.radius * .4 - tropicalCore) * transition;
      const cycle = s.eyewallCycle, outer = cycle?.strength || 0, inner = cycle?.inner ?? 1;
      const sign = (s.lat < 0 ? -1 : 1) * (anti ? -1 : 1);
      const dryCos = Math.cos(s.dryAirAngle || 0), drySin = Math.sin(s.dryAirAngle || 0);
      const backgroundVentilation = 1 - smooth(.05,.45,s.dryIntrusion || 0);
      const mature = smooth(25, 55, s.wind) * smooth(.35, .8, s.organization) * (1 - transition);
      const coherence = smooth(32, 62, s.wind) * smooth(.55, .9, s.organization)
        * (1 - .7 * (s.dryIntrusion || 0)) * (1 - transition)
        * (.35 + .65 * smooth(.25, .85, s.coreSymmetry ?? 0)) * (1 - .8 * hybrid);
      // Advect the vortex's moist envelope with its actual translation. The
      // old flow moved air only with the ambient steering while the marker
      // followed beta/Fujiwara/manual steering: the low could leave its own
      // moisture behind and repeatedly enter an empty mesh as a round blob.
      const center = this.point(s.lon, s.lat);
      const driftU = Number.isFinite(s.u) ? s.u - this.sample(e.u, center.x, center.y) : 0;
      const driftV = Number.isFinite(s.v) ? s.v - this.sample(e.v, center.x, center.y) : 0;
      // Before the eyewall closes, deep bursts can occur inside the RMW.
      // Do not prescribe a hollow annulus merely because a radius exists.
      // A closed convecting wall drives a compensating interior downdraft
      // BEFORE the eye becomes cloud-free. Using optical visibility as the
      // only source of descent trapped intense storms beneath their overcast.
      const wallDescent = smooth(48,72,s.wind) * smooth(.5,.84,s.coreSymmetry ?? 0)
        * smooth(.25,.72,s.warmCore ?? 0) * smooth(.55,.88,s.organization)
        * (1 - smooth(8,20,this.sample(e.shear,center.x,center.y)))
        * (1 - smooth(.15,.7,s.dryIntrusion || 0)) * inner * (1 - hybrid);
      const coreDescent = Math.max(s.eye || 0,wallDescent) * (1-transition);
      const wallClosure = smooth(.08,.65,coreDescent);
      const band = !anti && !extra ? s.eyeBand || 0 : 0, angle = s.rotation || 0;
      const moatContrast = outer ? smooth(.12, .85, (cycle.radius - rmw) / rmw) : 0;
      this.forStorm(s, Math.min(s.customRadius ? 6500 : 1500, s.radius * 2.5), (i, dx, dy, r) => {
        // The centre has no tangential direction, but must still subside.
        r = Math.max(.01,r);
        const damaged = !anti && s.terrainAsymmetry > .0001;
        const bearing = damaged ? Math.atan2(dx, dy) : 0;
        const reach = damaged ? terrainCirculationRadius(s, bearing) : s.radius;
        const taper = Math.exp(-r * r / (reach * reach * 2));
        const primary = Math.min(r / rmw, (rmw / r) ** .65);
        const secondary = outer ? Math.exp(-(((r - cycle.radius) / (cycle.radius * .32)) ** 2)) : 0;
        const terrainFactor = damaged ? terrainWindFactor(s, bearing, r) : 1;
        const tangential = s.wind * 3.6 * Math.max(primary * (.65 + .35 * inner), secondary * outer * .9) * taper * terrainFactor;
        // Mature eyewall convergence must not continue unchanged into the eye:
        // that used to lift/condense the centre faster than subsidence cleared it.
        const lane = band > .01 ? bandAnomaly(r / rmw, dx / r, dy / r, angle, sign, band) : 0;
        const vent = 1 - .7 * Math.max(0, lane);
        const eyeInterior = !anti ? coreDescent * (1 - smooth(rmw * .35, rmw, r)) * vent : 0;
        const inflow = tangential * .13 * s.organization * (1 - eyeInterior) * (anti ? -1 : 1);
        this.u[i] += (-sign * dy * tangential - dx * inflow) / r + driftU * taper;
        this.v[i] += (sign * dx * tangential - dy * inflow) / r + driftV * taper;
        // Convergent boundary-layer flow lifts moist air across a resolved
        // eyewall and rain envelope; no painted spiral or fixed cloud sprite.
        if (anti) {
          const sinking = .16 * s.organization * taper;
          this.sink[i] += sinking;
          if (geometry) geometry.sink[i] += sinking;
          return;
        }
        // Established, moist warm-core circulation can sustain an eyewall.
        // Preserve that regime without granting the same annular convection
        // to every moderate/dry vortex. This is a tendency coefficient, not
        // cloud water or a rendered mask; RH still gates the actual ascent.
        this.coreSupport[i] = Math.max(this.coreSupport[i], coherence * terrainFactor
          * (1 - smooth(rmw * 1.5, rmw * 3, r)));
        if (!extra && s.dryIntrusion > .001) {
          const sector = Math.max(0, (dx * dryCos + dy * drySin) / r) ** 2;
          const mixing = .4 * s.dryIntrusion * sector * smooth(rmw, rmw * 2, r) * Math.exp(-r / s.radius);
          this.dryMix[i] += mixing;
          this.dryVapor[i] += mixing * saturation(e.temperature[i]) * clamp(s.dryAirHumidity / 100, .2, .8);
        }
        const directional = (dx * e.shearCos[i] + dy * e.shearSin[i]) / r;
        // Environmental shear can ventilate the upshear rainbands even when
        // no discrete inner-core dry-intrusion event is active. Exchange air
        // on a crossing timescale (km/h / km), not a circular cloud mask.
        if (!extra && directional < 0 && backgroundVentilation > 0) {
          const exchange = flaq_rainbandExchange(backgroundVentilation,directional,e.shear[i],reach,taper,eyeInterior,r,rmw);
          this.dryMix[i] += exchange;
          this.dryVapor[i] += exchange * e.targetVapor[i];
        }
        const asymmetry = Math.max(0, directional) * (s.baroclinicity || .2);
        const frontal = (1 + (asymmetry - 1) * transition)
          * (1 - .55 * hybrid + .55 * hybrid * Math.max(0, .4 + .6 * directional));
        const shearContrast = e.shearContrast[i];
        const moistureSector = clamp(this.vapor[i] / saturation(this.temperature[i]), 0, 1.05);
        const coldSuppression = 1 / (1 + this.cold[i] * .7);
        const localCore = rmw * (1 + shearContrast * .35 * (2 * directional * directional - 1));
        const convectionSector = smooth(.62, 1, moistureSector) * (1 + shearContrast * directional)
          * e.activitySector[i] * coldSuppression;
        // An organized inner wall is an outcome reserved for mature moist
        // cores. A dry, moderate storm must not be forced into a uniform torus.
        const coreWidth = rmw * (.85 - .35 * coherence);
        const ascentCenter = localCore * (.55 + .45 * wallClosure);
        const coreLift = s.organization * terrainFactor * terrainFactor * ((.22 + .2 * coherence) * inner * (1 + .88 * lane) * Math.exp(-(((r - ascentCenter) / coreWidth) ** 2))
          + .25 * Math.max(0, lane)
          + .44 * outer * secondary
          + .12 * (1 - eyeInterior) * Math.exp(-r / Math.max(80, s.radius * .8)));
        this.lift[i] += frontal * convectionSector * coreLift;
        // An interrupted sector cannot keep the undamaged eye's prescribed
        // clearing/downward return circulation. Condensate still evolves in
        // step(); no mountain mask is ever applied to rendered cloud alpha.
        const eyeSink = coreDescent * vent * terrainFactor * (1.4 + .8 * wallDescent)
          * Math.exp(-((r / (rmw * (.55 + .16 * wallDescent))) ** 2));
        this.sink[i] += eyeSink;
        // Compensating descent outside organized convection. Weak lows do not
        // punch a hole in the sky. Wet/convergent sectors retain feeder bands;
        // drying is a tendency in q/c/T, never an opacity/texture mask.
        const outerReturn = smooth(rmw * 2, Math.max(rmw * 3, s.radius * .65), r)
          * Math.exp(-((r / (s.radius * 1.7)) ** 2));
        const wetSector = smooth(.72, 1, moistureSector);
        const returnFlow = mature * outerReturn * terrainFactor * (1 - .45 * Math.max(0, directional));
        this.sink[i] += returnFlow * (.12 - .085 * wetSector);
        if (geometry) {
          geometry.moistLift[i] += frontal * (1 + shearContrast * directional) * e.activitySector[i] * coreLift;
          geometry.sink[i] += eyeSink + returnFlow * .12;
          geometry.moistSink[i] -= returnFlow * .085;
        }
        if (outer) {
          const moat = (rmw + cycle.radius) * .5, width = Math.max(8, (cycle.radius - rmw) * .25);
          const moatSink = outer * moatContrast * .35 * Math.exp(-(((r - moat) / width) ** 2));
          this.sink[i] += moatSink;
          if (geometry) geometry.sink[i] += moatSink;
        }
      }, touched);
    }
    if (hasCyclone) this.resolveInflowAscent(touched);
    if (geometry) {
      for (const key of ['u', 'v', 'dryMix', 'dryVapor']) geometry[key].set(this[key]);
      geometry.environment = this.envTime;
    }
    this.coldPoolFlow();
  }
  resolveInflowAscent(touched) {
    // Isolate prescribed vortex convergence BEFORE cold-pool outflow. Ambient
    // fronts, monsoon convergence and ordinary cloud renewal retain their
    // existing physics. This geometry is reused with the velocity cache.
    const w = this.width, e = this.envFields;
    for (let y = 0; y < this.height; y++) {
      const up=Math.max(0,y-1), down=Math.min(this.height-1,y+1);
      // Only vortex-modified winds differ from ambient. Include the stencil
      // halo; a wrapped interval conservatively covers the full row.
      const lo=touched? Math.max(0,Math.min(touched.lo[y]-1,touched.lo[up],touched.lo[down])):0;
      const hi=touched? Math.min(w-1,Math.max(touched.hi[y]+1,touched.hi[up],touched.hi[down])):w-1;
      for (let x = lo; x <= hi; x++) {
      const i = y * w + x;
      const left = x ? i - 1 : (this.periodic ? i + w - 1 : i);
      const right = x < w - 1 ? i + 1 : (this.periodic ? i - w + 1 : i);
      const above = up*w+x, below = down*w+x;
      const divergence = ((this.u[right] - e.u[right]) - (this.u[left] - e.u[left])) / (2 * this.kmx[y])
        - ((this.v[below] - e.v[below]) - (this.v[above] - e.v[above])) / (2 * this.kmy[y]);
      this.inflowAscent[i] = Math.max(0, -divergence * 2);
      }
    }
  }
  coldPoolFlow() {
    const w = this.width;
    const cold = this.coldPressure();
    // The cold pool is prognostic and must be recomputed on EVERY substep.
    for (let y = 1; y < this.height - 1; y++) for (let x = this.periodic ? 0 : 1; x < (this.periodic ? w : w - 1); x++) {
      const i = y * w + x;
      const left = x ? i - 1 : i + w - 1, right = x + 1 < w ? i + 1 : i - w + 1;
      this.u[i] -= 240 * (cold[right] - cold[left]) / (2 * this.kmx[y]);
      this.v[i] += 240 * (cold[i + w] - cold[i - w]) / (2 * this.kmy[y]);
    }
  }
  // The pressure head of a spreading cold pool integrates buoyancy over
  // kilometres. Differentiating single 4 km cells created an alternating
  // grid-scale convergence feedback, particularly in non-rotating convection.
  coldPressure() {
    const w=this.width,h=this.height,mid=h>>1;
    const rx=Math.min(w-1,Math.round(14/this.kmx[mid])),ry=Math.min(h-1,Math.round(14/this.kmy[mid]));
    if(!rx&&!ry)return this.cold;
    const src=this.cold, tmp=this.coldRow ||= new Float32Array(this.n), out=this.coldArea ||= new Float32Array(this.n);
    const ix=this.periodic ? i=>(i+w)%w : i=>Math.min(w-1,Math.max(0,i));
    for(let y=0;y<h;y++){
      const row=y*w;let sum=0;
      for(let x=-rx;x<=rx;x++)sum+=src[row+ix(x)];
      for(let x=0;x<w;x++){
        tmp[row+x]=sum/(2*rx+1);
        sum+=src[row+ix(x+rx+1)]-src[row+ix(x-rx)];
      }
    }
    for(let x=0;x<w;x++){
      let sum=0;
      for(let y=-ry;y<=ry;y++)sum+=tmp[Math.max(0,y)*w+x];
      for(let y=0;y<h;y++){
        out[y*w+x]=sum/(2*ry+1);
        sum+=tmp[Math.min(h-1,y+ry+1)*w+x]-tmp[Math.max(0,y-ry)*w+x];
      }
    }
    return out;
  }
  advectCloud(dt) {
    // Limited semi-Lagrangian MacCormack (Selle et al., 2008). Correct only
    // transport, NOT irreversible condensation/rain/evaporation. This retains
    // resolved filaments as they turn instead of blurring them into a ring.
    // The donor-cell extrema limiter prevents invented water or dark halos.
    const w = this.width, h = this.height, e = this.envFields;
    this.cloudTransport ||= Array.from({ length: 4 }, () => new Float32Array(this.n));
    const [predicted, corrected, minimum, maximum] = this.cloudTransport;
    const {u, v, water, kmx, kmy} = this, {upperU, upperV} = e;
    const periodic = this.periodic;
    const longitude = periodic
      ? x => x >= 0 && x < w ? x : x - Math.floor(x / w) * w
      : x => clamp(x, 0, w - 1.001);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const bx = longitude(x - (u[i] + upperU[i]) * dt / kmx[y]);
      const by = clamp(y + (v[i] + upperV[i]) * dt / kmy[y], 0, h - 1.001);
      const ix = Math.floor(bx), iy = Math.floor(by), a = bx - ix, b = by - iy, j = iy * w + ix;
      const jr = ix === w - 1 ? iy * w : j + 1;
      const q00 = water[j], q10 = water[jr], q01 = water[j + w], q11 = water[jr + w];
      predicted[i] = (q00 * (1 - a) + q10 * a) * (1 - b) + (q01 * (1 - a) + q11 * a) * b;
      minimum[i] = Math.min(q00, q10, q01, q11); maximum[i] = Math.max(q00, q10, q01, q11);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const bx = longitude(x + (u[i] + upperU[i]) * dt / kmx[y]);
      const by = clamp(y - (v[i] + upperV[i]) * dt / kmy[y], 0, h - 1.001);
      const ix = Math.floor(bx), iy = Math.floor(by), a = bx - ix, b = by - iy, j = iy * w + ix;
      const jr = ix === w - 1 ? iy * w : j + 1;
      const reverse = (predicted[j] * (1-a) + predicted[jr] * a) * (1-b)
        + (predicted[j+w] * (1-a) + predicted[jr+w] * a) * b;
      corrected[i] = clamp(predicted[i] + .5 * (water[i] - reverse), minimum[i], maximum[i]);
    }
    return corrected;
  }
  step(dt, systems, reuseGeometry = false) {
    this.flow(systems, reuseGeometry);
    const transported = !this.kernel && this.secondOrderTransport !== false ? this.advectCloud(dt) : null;
    const [q1, c1, t1, p1] = this.next, e = this.envFields, w = this.width;
    const convection = this.convection, convectionNext = this.convectionNext ||= new Float32Array(this.n);
    if (this.kernel) {
      this.kernel.step(this, dt, transported);
      this.finishStep(); return;
    }
    const convectionResponse = 1 - Math.exp(-dt / 1.5);
    const relaxT = 1 - Math.exp(-dt / 24), relaxQ = 1 - Math.exp(-dt / 18);
    const condenseRate = 1 - Math.exp(-dt * 3), rainRate = 1 - Math.exp(-dt / 4), coldRate = 1 - Math.exp(-dt / 8);
    // Keep the hot numerical loop on typed arrays. No field lookups through
    // changing parent/nest object layouts for every scalar/cell/substep.
    const { vapor, water, temperature, cold: coldField, u, v, land, seaCooling,
      soilHeat, soilWater, inflowAscent, coreSupport, lift, sink, dryMix, dryVapor } = this;
    const { upperU, upperV, sst, thermalHumidity, activityLift, front, activitySector,
      ambientLift, temperature: ambientTemperature, surfaceSaturation, targetVapor } = e;
    const h = this.height, periodic = this.periodic;
    for (let y = 0; y < this.height; y++) {
      const kmx = this.kmx[y], kmy = this.kmy[y];
      const mixX = Math.min(.12, 18 * dt / (kmx * kmx));
      const mixY = Math.min(.12, 18 * dt / (kmy * kmy));
      const aboveRow = Math.max(0, y - 1) * w, belowRow = Math.min(h - 1, y + 1) * w;
      for (let x = 0; x < w; x++) {
      const i = y * w + x, left = x ? i - 1 : (periodic ? i + w - 1 : i), right = x < w - 1 ? i + 1 : (periodic ? i - w + 1 : i);
      const above = aboveRow + x, below = belowRow + x;
      const rawX = x - u[i] * dt / kmx;
      const bx = periodic ? (rawX < 0 || rawX >= w ? rawX - Math.floor(rawX / w) * w : rawX) : clamp(rawX, 0, w - 1.001);
      const by = clamp(y + v[i] * dt / kmy, 0, h - 1.001);
      const ix = Math.floor(bx), iy = Math.floor(by), a = bx - ix, b = by - iy, j = iy * w + ix;
      const aa = (1 - a) * (1 - b), ab = a * (1 - b), ba = (1 - a) * b, bb = a * b;
      const jr = ix === w - 1 ? iy * w : j + 1;
      let q = vapor[j] * aa + vapor[jr] * ab + vapor[j + w] * ba + vapor[jr + w] * bb;
      let t = temperature[j] * aa + temperature[jr] * ab + temperature[j + w] * ba + temperature[jr + w] * bb;
      let cold = coldField[j] * aa + coldField[jr] * ab + coldField[j + w] * ba + coldField[jr + w] * bb;
      let c;
      if (transported) c = transported[i];
      else {
        // The parent has a periodic x domain. Inline this second transport
        // footprint rather than calling the polymorphic parent/nest sampler
        // 327,680 times per step. Preserve the original interpolation order.
        let cx = bx - upperU[i] * dt / kmx;
        if (periodic) { if (cx < 0 || cx >= w) cx -= Math.floor(cx / w) * w; }
        else cx = clamp(cx, 0, w - 1.001);
        const cy = clamp(by + upperV[i] * dt / kmy, 0, h - 1.001);
        const x0 = Math.floor(cx), y0 = Math.floor(cy), ax = cx - x0, ay = cy - y0;
        const j0 = y0 * w + x0, j1 = x0 === w - 1 ? y0 * w : j0 + 1;
        c = (water[j0] * (1 - ax) + water[j1] * ax) * (1 - ay)
          + (water[j0 + w] * (1 - ax) + water[j1 + w] * ax) * ay;
      }
      // Small physical mixing, expressed in km²/h instead of a per-grid blur.
      // It damps the fine mesh's numerical filaments, not its resolved eye.
      c = c * (1 - 2 * mixX - 2 * mixY) + mixX * (water[left] + water[right]) + mixY * (water[above] + water[below]);
      const divergence = (u[right] - u[left]) / (2 * kmx) - (v[below] - v[above]) / (2 * kmy);
      const ocean = 1 - land[i];
      const surfaceTemperature = ocean ? sst[i] - seaCooling[i] : soilHeat[i];
      const wetSurface = ocean ? 1 : smooth(.35, .85, soilWater[i]);
      // Parameterized unresolved moist thermals: lift is driven by surface-air
      // buoyancy and humidity, not by a prescribed rendered cloud amount.
      const relativeHumidity = q / saturation(t);
      const thermalLift = wetSurface * smooth(19, 29, surfaceTemperature)
        * smooth(.5, 3, surfaceTemperature - t) * smooth(.55, .95, relativeHumidity)
        * thermalHumidity[i] * activityLift[i];
      // Cold-ocean / midlatitude cloud sources cannot depend on the tropical
      // SST gate. Frontal ascent and moist-layer radiative cooling continue
      // after the seeded initial clouds rain out. Both act on thermodynamics.
      const frontalLift = front[i] * smooth(.6, .95, relativeHumidity) * .1;
      const radiativeCooling = smooth(.65, 1, relativeHumidity) * (.035 + .045 * smooth(0, .6, c));
      // Horizontal convergence is not automatically deep cloudy ascent. The
      // prescribed radial inflow used to bypass the moisture/instability/cold
      // pool gates applied to the core above, saturating a smooth white ring
      // even when that core's convection was inhibited. Use the transported
      // thermodynamic state for BOTH routes; leave resolved descent intact.
      let resolvedLift = -divergence * 2;
      if (inflowAscent[i] > 0) {
        const supportedCore = coreSupport[i];
        const convectiveResponse = smooth(.62, 1, relativeHumidity)
          * (supportedCore + (1 - supportedCore) * activitySector[i])
          / (1 + cold * .7 * (1 - supportedCore * .8));
        resolvedLift -= inflowAscent[i] * (1 - convectiveResponse);
      }
      const uplift = clamp(resolvedLift + lift[i] + thermalLift + frontalLift
        + ambientLift[i], -.3, 1);
      t += (ambientTemperature[i] - t) * relaxT - (uplift * 3.6 + radiativeCooling) * dt + sink[i] * dt * .8;
      const sat = saturation(t);
      // Moisture supply responds to wind, saturation deficit and surface water;
      // latent flux can continue after the initial seeded clouds have rained out.
      const surfaceSat = ocean && !seaCooling[i] ? surfaceSaturation[i] : saturation(surfaceTemperature);
      const evaporation = surfaceVaporSupply(surfaceSat, q, Math.sqrt(u[i] * u[i] + v[i] * v[i]), wetSurface, ocean) * dt;
      const imported = (targetVapor[i] - q) * relaxQ;
      // A strong resolved convective sink must not be immediately refilled by
      // the unresolved humidity relaxation; surface evaporation remains live.
      q += imported * (imported > 0 ? 1 - clamp(lift[i] * 2 + sink[i] * 5, 0, .85) : 1) + evaporation;
      if (dryMix[i] > 0) {
        const drySource = dryVapor[i] / dryMix[i];
        q += (Math.min(q, drySource) - q) * (1 - Math.exp(-dryMix[i] * dt));
      }
      // Exchange with drier descending air, not a visual alpha cutout. Merely
      // evaporating cloud into the same saturated layer re-condensed it at once.
      if (sink[i] > 0) q += (Math.min(q, sat * .6) - q) * (1 - Math.exp(-sink[i] * dt * 2));
      // Moist subcolumns can reach saturation before the marine grid mean.
      // Repartition *existing* water; keep the deep-convection diagnostic separate.
      const resolved = Math.max(0, q - sat);
      const target = ocean ? flaq_marineTarget(q,c,sat,activitySector[i],sink[i]) : 0;
      const condensed = flaq_condensation(q,resolved,c,target,condenseRate);
      // A transported, finite-response diagnostic, not the last substep's
      // condensation spike. The same footprint as moist air avoids trails
      // fixed to map cells; this memory never feeds back into cloud physics.
      const advectedConvection = convection[j] * aa + convection[jr] * ab + convection[j + w] * ba + convection[jr + w] * bb;
      const convectionTarget = Math.max(0, uplift) * resolved * condenseRate / dt;
      convectionNext[i] = advectedConvection + (convectionTarget - advectedConvection) * convectionResponse;
      q -= condensed; c += condensed; t += condensed * 1.8;
      const evaporated = flaq_reevaporation(c,q,sat,target,sink[i],dt);
      c -= evaporated; q += evaporated; t -= evaporated * 1.8;
      const rain = Math.max(0, c - .3) * rainRate; c -= rain;
      if (!ocean) {
        soilWater[i] = clamp(soilWater[i] + rain * .045 - evaporation * .012 - dt * .0015, 0, 1);
        soilHeat[i] += (ambientTemperature[i] - soilHeat[i]) * relaxT - evaporation * .12;
      }
      cold += rain * .8 + evaporated * .5 - cold * coldRate;
      q1[i] = clamp(q, 0, 40); c1[i] = clamp(c, 0, 8); t1[i] = clamp(t, -25, 40); p1[i] = clamp(cold, 0, 8);
      }
    }
    this.finishStep();
  }
  finishStep() {
    const previous = [this.vapor, this.water, this.temperature, this.cold];
    [this.vapor, this.water, this.temperature, this.cold] = this.next;
    this.next = previous;
    [this.convection, this.convectionNext] = [this.convectionNext, this.convection];
  }
  advance(hours, env, systems, maxStep = .5) {
    this.systems = systems; this.stateRevision = (this.stateRevision || 0) + 1;
    this.refreshEnvironment(env, this.time); this.inject(systems);
    const steps = Math.ceil(Math.max(0, hours) / maxStep);
    for (let n = 0; n < steps; n++) {
      const dt = hours / steps;
      this.refreshEnvironment(env, this.time); this.step(dt, systems, n > 0); this.time += dt;
    }
  }
  diagnostics(systems) {
    return systems.map(s => {
      const p = this.point(s.lon, s.lat); let c = 0, rh = 0, landEnergy = 0;
      const row = clamp(Math.round(p.y), 0, this.height - 1), radius = radiusOfMaximumWind(s);
      const rx = Math.max(1, radius / this.kmx[row]), ry = Math.max(1, radius / this.kmy[row]);
      // Sample the convective ring, not just a dry eye at the centre.
      for (const [dx, dy] of [[rx, 0], [-rx, 0], [0, ry], [0, -ry], [rx * .7, ry * .7], [-rx * .7, -ry * .7]]) {
        const x = p.x + dx, y = p.y + dy;
        c += this.sample(this.water, x, y);
        rh += this.sample(this.vapor, x, y) / saturation(this.sample(this.temperature, x, y)) * 100;
        landEnergy += smooth(.4, .85, this.sample(this.soilWater, x, y)) * smooth(23, 30, this.sample(this.soilHeat, x, y));
      }
      const dynamics = this.dynamicsAt(p.x, p.y);
      const result = { id: s.id, convection: c / 6, humidity: clamp(rh / 6, 0, 100), landEnergy: landEnergy / 6,
        ...this.coreStructure(s), ...dynamics };
      if (s.kind === 'cloud' && this.hasTransportWind) this.sampleCloudWind(p, result);
      return result;
    });
  }
  // Same signed km/h field used to advect condensate, including shear aloft.
  // Feedback carries a velocity, not a force to add to the background again.
  sampleCloudWind({x, y}, result) {
    result.cloudU = this.sample(this.u, x, y) + this.sample(this.envFields.upperU, x, y);
    result.cloudV = this.sample(this.v, x, y) + this.sample(this.envFields.upperV, x, y);
  }
  coreStructure(s) {
    const p = this.point(s.lon, s.lat), row = clamp(Math.round(p.y), 0, this.height - 1);
    const radius = radiusOfMaximumWind(s), rx = radius / this.kmx[row], ry = radius / this.kmy[row];
    // A coarse global cell cannot distinguish the eye from its wall.
    if (s.kind !== 'disturbance' || Math.min(rx, ry) < 2) return {};
    let sum = 0, squared = 0, cover = 0;
    for (let j = 0; j < 16; j++) {
      const angle = j * Math.PI / 8, x = Math.cos(angle), y = Math.sin(angle);
      const ring = .5 * (this.sample(this.water, p.x + rx * x, p.y + ry * y)
        + this.sample(this.water, p.x + rx * 1.6 * x, p.y + ry * 1.6 * y));
      sum += ring; squared += ring * ring;
      cover += this.sample(this.water, p.x + rx * .3 * x, p.y + ry * .3 * y);
    }
    const mean = sum / 16, deviation = Math.sqrt(Math.max(0, squared / 16 - mean * mean));
    return { coreSymmetry: smooth(.05, .4, mean) * clamp(1 - deviation / (mean + .05), 0, 1),
      coreCloud: cover / 16, coreResolved: true };
  }
  dynamicsAt(x, y) {
    const row = clamp(Math.round(y), 0, this.height - 1), dx = 2 * this.kmx[row], dy = 2 * this.kmy[row];
    const duDx = (this.sample(this.u, x + 1, y) - this.sample(this.u, x - 1, y)) / dx;
    const dvDy = (this.sample(this.v, x, y - 1) - this.sample(this.v, x, y + 1)) / dy;
    const dvDx = (this.sample(this.v, x + 1, y) - this.sample(this.v, x - 1, y)) / dx;
    const duDy = (this.sample(this.u, x, y - 1) - this.sample(this.u, x, y + 1)) / dy;
    return { vorticity: (dvDx - duDy) / 3600, convergence: -(duDx + dvDy) / 3600 };
  }
  inspect(point) {
    if (!point) return null;
    const p = this.point(point.lon, point.lat), result = { lon: point.lon, lat: point.lat };
    for (const key of ['sst', 'ohc', 'shear', 'pressure']) result[key] = this.sample(this.envFields[key], p.x, p.y);
    result.cooling = this.sample(this.seaCooling, p.x, p.y);
    result.sst -= result.cooling;
    result.ohc = Math.max(0, result.ohc - .409 * result.cooling * this.sample(this.envFields.depth26, p.x, p.y) * .5);
    result.temperature = this.sample(this.temperature, p.x, p.y);
    result.humidity = clamp(this.sample(this.vapor, p.x, p.y) / saturation(result.temperature) * 100, 0, 100);
    result.water = this.sample(this.water, p.x, p.y);
    return result;
  }
  candidates(systems) {
    // Every cloudy cell is eligible; a local maximum is tracked only if no existing
    // circulation candidate covers its neighbourhood. Not a fixed list of sprites.
    const maxima = [], found = [];
    for (let y = 2; y < this.height - 2; y++) {
      // No basin whitelist: cold water, weak Coriolis and shear still constrain genesis.
      if (Math.abs(this.lat[y]) < 2 || Math.abs(this.lat[y]) > 80) continue;
      for (let x = 2; x < this.width - 2; x++) {
        const i = y * this.width + x, water = this.water[i];
        if (this.land[i] || water < .15 || water <= this.water[i - 1] || water <= this.water[i + 1]
          || water <= this.water[i - this.width] || water <= this.water[i + this.width]) continue;
        const lon = this.lon[x], lat = this.lat[y], cos = Math.cos(lat * DEG);
        const dynamics = this.dynamicsAt(x, y);
        const med = isMediterranean(lon, lat) && this.envFields.sst[i] > 18 && this.envFields.shear[i] < 24;
        if (Math.sign(lat) * dynamics.vorticity < 2e-6 || dynamics.convergence < 1e-7 || (!med && this.envFields.sst[i] < 26)) continue;
        maxima.push({ lon, lat, convection: water, fieldVorticity: dynamics.vorticity, fieldConvergence: dynamics.convergence, cos });
      }
    }
    maxima.sort((a, b) => b.convection - a.convection);
    for (const candidate of maxima) {
      const near = s => Math.hypot(longitudeDelta(s.lon, candidate.lon) * 111.2 * candidate.cos, (s.lat - candidate.lat) * 111.2) < (s.kind === 'disturbance' ? Math.max(550, s.radius * 1.6) : 450);
      if (!systems.some(near) && !found.some(near)) found.push(candidate);
    }
    return found;
  }
  pixels(layer = 'cloud', blend = 1, previous = this.next[1]) {
    if (layer !== 'cloud' && isCloudProduct(layer)) return cloudProductPixels(this, layer);
    const pixels = new Uint8ClampedArray(this.n * 4);
    // Lighting follows solver revisions, not the 24 Hz presentation clock.
    // Interpolate cached end states rather than differentiating every pixel twice per frame.
    if (layer === 'cloud') {
      if (this.lightTime !== this.time || this.lightInjection !== this.injectionRevision || this.lightPreviousSource !== previous) {
        this.currentLightDirty = this.previousLightDirty = true;
      }
      this.lightTime = this.time; this.lightInjection = this.injectionRevision; this.lightPreviousSource = previous;
      this.lightCurrent ||= new Uint8Array(this.n); this.lightPrevious ||= new Uint8Array(this.n);
      const shade = (water, output) => {
        const w = this.width;
        for (let y = 0; y < this.height; y++) {
          const row = y * w, aboveRow = Math.max(0, y - 1) * w, belowRow = Math.min(this.height - 1, y + 1) * w;
          const kmx = Math.max(6, this.kmx[y]), kmy = Math.max(6, this.kmy[y]);
          for (let x = 0; x < w; x++) {
            const i = row + x;
            const left = water[x ? i - 1 : (this.periodic ? i + w - 1 : i)];
            const right = water[x + 1 < w ? i + 1 : (this.periodic ? i - w + 1 : i)];
            const above = water[aboveRow + x], below = water[belowRow + x];
            const nx = clamp((left - right) * 60 / kmx, -.65, .65);
            const ny = clamp((above - below) * 60 / kmy, -.65, .65);
            const diffuse = Math.max(0, (-nx * .45 - ny * .55 + .7) / Math.sqrt(1 + nx * nx + ny * ny));
            output[i] = clamp(222 + 34 * diffuse, 222, 254);
          }
        }
      };
      if (this.currentLightDirty) { shade(this.water, this.lightCurrent); this.currentLightDirty = false; }
      if (blend !== 1 && this.previousLightDirty) { shade(previous, this.lightPrevious); this.previousLightDirty = false; }
      if (blend === 1 && littleEndian) {
        const rgba = new Uint32Array(pixels.buffer), light = this.lightCurrent, water = this.water;
        for (let i = 0; i < rgba.length; i++) rgba[i] = lightRGB[light[i]] | cloudOpacity(water[i]) << 24;
        return pixels;
      }
    }
    const limits = { sst: [12, 32], ohc: [0, 140], humidity: [25, 100], shear: [0, 40], temperature: [0, 35], cooling: [0, 6] };
    const pressure = layer === 'pressure' ? pressureSurface(this) : null;
    const [minimum, maximum] = pressure ? pressureRange(this.systems) : limits[layer] || [0,1];
    for (let i = 0; i < this.n; i++) {
      const k = i * 4;
      if (layer === 'cloud') {
        const c = blend === 1 ? this.water[i] : previous[i] * (1 - blend) + this.water[i] * blend;
        const light = blend === 1 ? this.lightCurrent[i] : this.lightPrevious[i] * (1 - blend) + this.lightCurrent[i] * blend;
        pixels[k] = light; pixels[k + 1] = Math.min(255, light + 3); pixels[k + 2] = Math.min(255, light + 6);
        pixels[k + 3] = cloudOpacity(c);
      } else {
        const value = pressure ? pressure[i] : layer === 'temperature' ? this.temperature[i] : layer === 'humidity'
          ? this.vapor[i] / saturation(this.temperature[i]) * 100 : layer === 'cooling' ? this.seaCooling[i]
          : layer === 'sst' ? this.envFields.sst[i] - this.seaCooling[i]
          : layer === 'ohc' ? Math.max(0, this.envFields.ohc[i] - .409 * this.seaCooling[i] * this.envFields.depth26[i] * .5) : this.envFields[layer][i];
        const a = clamp((value - minimum) / (maximum - minimum), 0, 1);
        pixels[k] = 40 + a * 210; pixels[k + 1] = 80 + Math.sin(a * Math.PI) * 140;
        pixels[k + 2] = 235 - a * 200; pixels[k + 3] = 165;
      }
    }
    return pixels;
  }
}
