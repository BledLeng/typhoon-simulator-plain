import { MoistAtmosphere } from './cloud-field.js?v=eye-low-44';
import { clamp, radiusOfMaximumWind } from './simulation.js?v=eye-42';
import { longitudeDelta } from './geography.js';
import { project, unproject } from './map-math.js';
import {advanceEyeLowCloud} from './eye-low-cloud.js';

const QUANTITIES = ['vapor', 'water', 'temperature', 'cold'];
const AUXILIARY_QUANTITIES = ['displayPrevious', 'soilWater', 'soilHeat', 'convection', 'eyeWater', 'eyeVapor'];
const REGRID_QUANTITIES = [...QUANTITIES, ...AUXILIARY_QUANTITIES];
const arrivalWeight = (patch, time) => {
  const t = clamp((time - (patch.createdAt ?? time)) / 3, 0, 1);
  return t * t * (3 - 2 * t);
};

// Nested numerical meshes, not storm pictures. Parent values provide initial
// and boundary conditions; interior moisture/temperature evolve independently.
export class CloudDetails {
  constructor(parent) { this.parent = parent; this.patches = new Map(); }

  movePatch(patch, storm, env) {
    const offsetX = longitudeDelta(storm.lon, patch.centerLon) * Math.PI / 180 / patch.dx;
    const offsetY = (project(0, storm.lat).y - project(0, patch.centerLat).y) / patch.dy;
    // Keep the numerical mesh stationary while the core stays in its guard
    // band. Regridding for every subpixel movement used to interpolate all
    // eight state fields and rebuild the entire environment at every tick.
    // Four cells are only 2.5% of a nest; presentation below still follows the
    // storm continuously in world coordinates. No coarser cells/time steps.
    if (Math.abs(offsetX) < 4 && Math.abs(offsetY) < 4) return;
    // Shift the solver lattice by whole cells. Moving through clear air must
    // not repeatedly interpolate away narrow bands in the overlapping mesh.
    // The renderer still follows the exact, fractional storm position.
    const dx = Math.round(offsetX) * patch.dx * 180 / Math.PI;
    const dy = Math.round(offsetY) * patch.dy;
    // Reuse the ping-pong arrays. Regrid only on a solver tick, never on camera
    // movement or every display frame (which would diffuse water repeatedly).
    const donor = Object.assign(Object.create(Object.getPrototypeOf(patch)), patch);
    patch.regridBuffers ||= AUXILIARY_QUANTITIES.map(() => new Float32Array(patch.n));
    for (let k = 0; k < 4; k++) patch[QUANTITIES[k]] = patch.next[k];
    for (const [k, name] of AUXILIARY_QUANTITIES.entries()) patch[name] = patch.regridBuffers[k];
    const top = Math.max(project(0, 85).y, Math.min(project(0, -85).y - (patch.bottom - patch.top), patch.top + dy));
    patch.relocate({ west: patch.bounds.west + dx, east: patch.bounds.east + dx,
      north: unproject(0, top).latitude, south: unproject(0, top + donor.bottom - donor.top).latitude });
    const rows = (top - donor.top) / donor.dy;
    const shift = Math.abs(rows - Math.round(rows)) < 1e-7
      ? [Math.round(offsetX), Math.round(rows)] : null; // a polar clamp can be fractional
    this.seed(patch, donor, false, shift);
    patch.next = QUANTITIES.map(name => donor[name]);
    patch.regridBuffers = AUXILIARY_QUANTITIES.map(name => donor[name]);
    patch.centerLon += dx;
    patch.centerLat = unproject(0, project(0, patch.centerLat).y + (top - donor.top)).latitude;
    patch.meshMoves = (patch.meshMoves || 0) + 1;
    patch.refreshEnvironment(env, patch.time);
  }

  advancePatch(patch, env, systems, maxStep) {
    const parent = this.parent, hours = Math.max(0, parent.time - patch.time);
    // New user-created clouds must also enter visible nests while paused.
    patch.advance(0, env, systems);
    if (hours <= 0) return;
    patch.displayPrevious.set(patch.water);
    this.seed(patch, parent, true);
    patch.hasColdWake = parent.hasColdWake;
    if (!parent.hasColdWake) patch.seaCooling.fill(0);
    else {
      const xs = Float64Array.from(patch.lon, lon => parent.point(lon, 0).x);
      for (let y = 0; y < patch.height; y++) {
        const py = parent.point(0, patch.lat[y]).y;
        for (let x = 0; x < patch.width; x++) patch.seaCooling[y * patch.width + x] = parent.sample(parent.seaCooling, xs[x], py);
      }
    }
    patch.advance(hours, env, systems, maxStep);
  }

  diagnostics(systems) {
    const result = this.parent.diagnostics(systems);
    // Resolve cloud transport and eye structure on the inner mesh when present;
    // retain the parent humidity/convection for intensity feedback.
    for (let i = 0; i < systems.length; i++) for (const patch of this.patches.values()) {
      const p = patch.point(systems[i].lon, systems[i].lat);
      if (p.x < patch.width * .2 || p.x > patch.width * .8 || p.y < patch.height * .2 || p.y > patch.height * .8) continue;
      if (systems[i].kind === 'cloud' && patch.hasTransportWind) {
        patch.sampleCloudWind(p, result[i]); break;
      }
      const core = patch.coreStructure(systems[i]);
      if (core.coreResolved) { Object.assign(result[i], core); break; }
    }
    return result;
  }

  seed(patch, source, boundaryOnly = false, shift = null) {
    const parent = this.parent, w = patch.width, h = patch.height;
    patch.sampleMaps ||= new WeakMap();
    const mapping = field => {
      let map = patch.sampleMaps.get(field);
      if (!map) {
        map = { x: Float64Array.from(patch.lon, lon => field.point(lon, 0).x),
          y: Float64Array.from(patch.lat, lat => field.point(0, lat).y) };
        patch.sampleMaps.set(field, map);
      }
      return map;
    };
    const from = mapping(source), coarse = mapping(parent);
    if (!boundaryOnly) {
      patch.displayPrevious ||= new Float32Array(patch.n);
      patch.eyeWater ||= new Float32Array(patch.n);
      patch.eyeVapor ||= new Float32Array(patch.n);
    }
    const names = boundaryOnly ? QUANTITIES : REGRID_QUANTITIES;
    const output = names.map(name => patch[name]);
    const channels = field => names.map(name => name === 'displayPrevious'
      ? field.displayPrevious || (field.time > 0 ? field.next[1] : field.water)
      : field[name] || ((name === 'eyeWater' || name === 'eyeVapor')
        ? (field.emptyEyeLayer??=new Float32Array(field.n)) : undefined));
    const sourceChannels = channels(source), parentChannels = source === parent ? sourceChannels : channels(parent);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (shift && y+shift[1]>=0 && y+shift[1]<h && x===Math.max(0,-shift[0])) {
        const end = Math.min(w,w-shift[0]);
        if (end>x) {
          const j=(y+shift[1])*w+x+shift[0], i=y*w+x;
          for (let k=0;k<output.length;k++) output[k].set(sourceChannels[k].subarray(j,j+end-x),i);
          // Land is geographic, not prognostic. Re-sample the parent mask.
          const row=clamp(Math.round(coarse.y[y]),0,parent.height-1)*parent.width;
          for(let xx=x;xx<end;xx++){
            const px=Math.round(coarse.x[xx]);
            patch.land[y*w+xx]=parent.land[row+(parent.periodic?(px%parent.width+parent.width)%parent.width:clamp(px,0,parent.width-1))];
          }
          x=end-1;
          continue;
        }
      }
      if (boundaryOnly && y >= 6 && y < h - 6 && x === 6) x = w - 6;
      const i = y * w + x;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const weight = boundaryOnly ? clamp(1 - edge / 6, 0, 1) : 1;
      if (!weight) continue;
      const outside = (!source.periodic && (from.x[x] < 0 || from.x[x] > source.width - 1)) || from.y[y] < 0 || from.y[y] > source.height - 1;
      const donor = outside ? parent : source, input = outside ? parentChannels : sourceChannels;
      let sx = outside ? coarse.x[x] : from.x[x], sy = outside ? coarse.y[y] : from.y[y];
      const dw = donor.width;
      if (donor.periodic) { if (sx < 0 || sx >= dw) sx -= Math.floor(sx / dw) * dw; }
      else sx = clamp(sx, 0, dw - 1.001);
      sy = clamp(sy, 0, donor.height - 1.001);
      const ix = Math.floor(sx), iy = Math.floor(sy), a = sx - ix, b = sy - iy;
      const j = iy * dw + ix, right = ix === dw - 1 ? iy * dw : j + 1;
      // One footprint for all seven transported quantities, not seven calls
      // repeating wrap/clamp/floor and looking up fields by string per cell.
      for (let channel = 0; channel < input.length; channel++) {
        const values = input[channel], target = output[channel];
        const value = (values[j] * (1 - a) + values[right] * a) * (1 - b)
          + (values[j + dw] * (1 - a) + values[right + dw] * a) * b;
        target[i] += (value - target[i]) * weight;
      }
      if (!boundaryOnly) {
        const px = Math.round(coarse.x[x]);
        const landX = parent.periodic ? ((px % parent.width) + parent.width) % parent.width : clamp(px, 0, parent.width - 1);
        patch.land[i] = parent.land[clamp(Math.round(coarse.y[y]), 0, parent.height - 1) * parent.width + landX];
      }
      if (parent.hasColdWake) patch.seaCooling[i] = parent.sample(parent.seaCooling, coarse.x[x], coarse.y[y]);
    }
  }

  update(systems, env) {
    const parent = this.parent;
    // A camera is an observer, never a forcing or mesh-lifetime input. Keep
    // existing storm nests resident, even offscreen; zoom/selection cannot
    // replace local condensate with a separately evolved viewport simulation.
    // A new weak low stays in the common cloud field. Do not immediately swap
    // a cloudy area for a separately resolving fine-grid disk on insertion.
    const visible = systems.filter(s => (s.kind === 'disturbance' || s.kind === 'subtropical') && s.wind >= 17.5);
    // Display thresholds never delete atmospheric water. Existing meshes also
    // evolve remnants and transitioned cyclones, using exactly the same solver.
    for (const [id, patch] of this.patches) {
      const host = systems.find(s => s.id === id);
      if (host && host.wind >= 7) patch.lastSupported = parent.time;
      const remnantHours = parent.time - (patch.lastSupported ?? parent.time);
      patch.detailWeight = 1 - clamp((remnantHours - 12) / 6, 0, 1);
      if (remnantHours < 18 && !visible.some(s => s.id === id)) {
        visible.push(host || { id, lon: patch.centerLon, lat: patch.centerLat, radius: patch.hostRadius });
      }
    }
    // The first three storms used to own the fine meshes indefinitely, even
    // after weakening. Later intense storms then remained a few coarse cells
    // wide (a round blob). Allocate by physical core demand, never the camera
    // or manual selection; a persistence margin prevents equal storms churning.
    const score = s => (s.wind || 0) * (.35 + .65 * (s.organization || 0)) * (this.patches.has(s.id) ? 1.18 : 1);
    visible.sort((a,b)=>score(b)-score(a)||a.id-b.id);
    const preferred=[];
    for(const s of visible) {
      if(preferred.length>=3)break;
      if(!preferred.some(other=>Math.abs(other.lat-s.lat)<13
        && Math.abs(longitudeDelta(other.lon,s.lon))*Math.cos(s.lat*Math.PI/180)<13))preferred.push(s);
    }
    const retiring=[];
    for(const [id,patch] of this.patches) {
      if(preferred.some(s=>s.id===id)) {patch.retireStarted=null;continue;}
      patch.retireStarted ??= parent.time;
      const t=clamp((parent.time-patch.retireStarted)/3,0,1);
      patch.detailWeight*=1-t*t*(3-2*t);
      if(t<1)retiring.push(visible.find(s=>s.id===id)||{id,lon:patch.centerLon,lat:patch.centerLat,radius:patch.hostRadius});
    }
    const ordered=[...retiring,...preferred.filter(s=>this.patches.has(s.id)),...preferred.filter(s=>!this.patches.has(s.id))];
    const active = new Set();
    // Bound work and memory independently of the number of latent cloud seeds.
    const chosen = [];
    for (const storm of ordered) {
      if (chosen.length >= 3) break;
      // One patch evolves all vortices in its domain; avoid stacked duplicate
      // clouds and overlapping mesh windows for close interacting systems.
      if (chosen.some(s => Math.abs(s.lat - storm.lat) < 13 && Math.abs(longitudeDelta(s.lon, storm.lon)) * Math.cos(storm.lat * Math.PI / 180) < 13)) continue;
      chosen.push(storm);
      active.add(storm.id);
      let patch = this.patches.get(storm.id);
      if (!patch) {
        // Reserve at least three cells per RMW for a compact core. Merely
        // widening the nest with the outer circulation could hide its eye.
        const latitude = clamp(storm.lat, -79, 79);
        const dy = Math.min(clamp(storm.radius * 1.4 / 111, 2.5, 6), 80 * radiusOfMaximumWind(storm) / (3 * 111));
        const dx = dy / Math.cos(latitude * Math.PI / 180);
        const bounds = { west: storm.lon - dx, east: storm.lon + dx, north: Math.min(85, latitude + dy), south: Math.max(-85, latitude - dy) };
        const next = new MoistAtmosphere(parent.seed, 160, 160, null, bounds);
        next.eyeWater=new Float32Array(next.n);next.eyeVapor=new Float32Array(next.n);
        next.refreshEnvironment(env, parent.time);
        this.seed(next, patch || parent);
        next.time = patch?.time ?? parent.time;
        next.injected = new Set(systems.map(s => s.id));
        next.centerLon = storm.lon; next.centerLat = storm.lat;
        next.hostRadius = storm.radius;
        next.hostId = storm.id;
        next.lastSupported = patch?.lastSupported ?? parent.time;
        next.detailWeight = patch?.detailWeight ?? 1;
        next.createdAt = patch?.createdAt ?? parent.time;
        next.feedbackTime = parent.time;
        for (let k = 0; k < 4; k++) next.next[k].set(next[QUANTITIES[k]]);
        patch = next; this.patches.set(storm.id, patch);
      }
      if (parent.time > patch.time) this.movePatch(patch, storm, env);
      // Presentation follows the centre continuously; image resampling below
      // keeps each parcel in world coordinates instead of dragging a square.
      patch.viewLon = storm.lon; patch.viewLat = storm.lat;
      const elapsed=parent.time-patch.time;
      this.advancePatch(patch, env, systems, .125);
      advanceEyeLowCloud(patch,systems,elapsed);
      if (patch.time > 0 && patch.feedbackTime !== parent.time) {
        this.restrictToParent(patch); patch.feedbackTime = parent.time;
      }
    }
    for (const [id, patch] of this.patches) if (!active.has(id)) {
      this.restrictToParent(patch);
      this.patches.delete(id);
    }
  }

  restrictToParent(patch) {
    // Average over the coarse cell footprint, not a single (possibly dry)
    // fine cell. Couple per simulated hour, never per presentation/request.
    const parent = this.parent;
    const elapsed=parent.time-(patch.feedbackTime ?? parent.time);
    if(elapsed<=0)return;
    const coupling=-Math.expm1(-elapsed/4)*arrivalWeight(patch,parent.time);
    patch.feedbackTime=parent.time;
    if(!coupling)return;
    const q=[...QUANTITIES,'convection'], fine=q.map(k=>patch[k]), coarse=q.map(k=>parent[k]);
    if(patch.displayPrevious){fine.push(patch.displayPrevious);coarse.push(parent.next[1]);}
    const sx=parent.dx/patch.dx/3,sy=parent.dy/patch.dy/3;
    const xMap = Float64Array.from(parent.lon, lon => patch.point(lon, 0).x);
    for (let y = 0; y < parent.height; y++) {
      if (parent.lat[y] <= patch.bounds.south || parent.lat[y] >= patch.bounds.north) continue;
      const py = patch.point(0, parent.lat[y]).y;
      for (let x = 0; x < parent.width; x++) {
        const px = xMap[x];
        if (px < 0 || px > patch.width - 1) continue;
        const radius = Math.hypot((px + .5) / patch.width * 2 - 1, (py + .5) / patch.height * 2 - 1);
        const t = clamp((.95 - radius) / .5, 0, 1), weight = t * t * (3 - 2 * t) * coupling;
        if (!weight) continue;
        const i = y * parent.width + x;
        for(let k=0;k<fine.length;k++){
          let sum=0;
          for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) sum+=patch.sample(fine[k],px+dx*sx,py+dy*sy);
          coarse[k][i]+=(sum/9-coarse[k][i])*weight;
        }
      }
    }
    parent.lightTime = -Infinity;
  }

  images(blend, parentPixels, layer = 'cloud') {
    return [...this.patches.values()].map(patch => {
      const resolved = patch.pixels(layer, blend, patch.displayPrevious), parent = this.parent;
      const dx = longitudeDelta(patch.viewLon, patch.centerLon);
      const dy = project(0, patch.viewLat).y - project(0, patch.centerLat).y;
      const bounds = { west: patch.bounds.west + dx, east: patch.bounds.east + dx,
        north: unproject(0, patch.top + dy).latitude, south: unproject(0, patch.bottom + dy).latitude };
      const sx = dx * Math.PI / 180 / patch.dx, sy = dy / patch.dy;
      const moving = Math.abs(sx) + Math.abs(sy) > 1e-6;
      const pixels = moving ? new Uint8ClampedArray(resolved.length) : resolved;
      const arrival = arrivalWeight(patch, parent.time);
      const source = parent, sourcePixels = parentPixels;
      patch.imageWeights ||= Float64Array.from({length:patch.n}, (_, i) => {
        const x = i % patch.width, y = Math.floor(i / patch.width);
        const radius = Math.hypot((x + .5) / patch.width * 2 - 1, (y + .5) / patch.height * 2 - 1);
        const t = clamp((.95 - radius) / .5, 0, 1);
        return t * t * (3 - 2 * t);
      });
      const seamKey = `${bounds.west}:${bounds.north}`;
      if (patch.seamSource !== source || patch.seamKey !== seamKey) {
        patch.seamKey = seamKey;
        patch.seamSource = source;
        const xMap = Float64Array.from(patch.lon, lon => ((source.point(lon + dx, 0).x % source.width) + source.width) % source.width);
        patch.seamLeft = Uint32Array.from(xMap, x => Math.floor(x) * 4);
        patch.seamRight = Uint32Array.from(xMap, x => (Math.floor(x) + 1) % source.width * 4);
        patch.seamFrac = Float64Array.from(xMap, x => x - Math.floor(x));
        patch.seamY = Float64Array.from(patch.lat, lat => clamp(source.point(0, unproject(0, project(0, lat).y + dy).latitude).y, 0, source.height - 1.001));
      }
      // A numerical mesh is rectangular; a storm is not. Blend the fine-grid
      // correction radially over a broad overlap, reaching the parent well
      // before every rectangle edge. Never expose the solver's tile boundary.
      const {width:w, height:h, seamLeft, seamRight, seamFrac, imageWeights} = patch;
      const stride = source.width * 4, detailWeight = patch.detailWeight ?? 1;
      const fineLeft = patch.fineLeft ||= new Uint32Array(w), fineFrac = patch.fineFrac ||= new Float64Array(w);
      if (moving) for (let x = 0; x < w; x++) {
        const xx = clamp(x + sx, 0, w - 1.001), ix = Math.floor(xx);
        fineLeft[x] = ix * 4; fineFrac[x] = xx - ix;
      }
      for (let y = 0; y < h; y++) {
        const py = patch.seamY[y], iy = Math.floor(py), b = py - iy, row = iy * stride;
        const yy = clamp(y + sy, 0, h - 1.001), fy = Math.floor(yy), ay = yy - fy, fineRow = fy * w * 4;
        for (let x = 0; x < w; x++) {
          const index = y * w + x, k = index * 4, weight = imageWeights[index] * detailWeight * arrival;
          if (weight === 1 && !moving) continue;
          const i = row + seamLeft[x], ir = row + seamRight[x], a = seamFrac[x];
          const j = fineRow + fineLeft[x], ax = fineFrac[x];
          for (let c = 0; c < 4; c++) {
            const coarse = weight === 1 ? 0 : (sourcePixels[i+c] * (1-a) + sourcePixels[ir+c] * a) * (1-b)
              + (sourcePixels[i+stride+c] * (1-a) + sourcePixels[ir+stride+c] * a) * b;
            const fine = !moving || weight === 0 ? resolved[k+c]
              : (resolved[j+c] * (1-ax) + resolved[j+4+c] * ax) * (1-ay)
              + (resolved[j+w*4+c] * (1-ax) + resolved[j+w*4+4+c] * ax) * ay;
            pixels[k+c] = coarse * (1-weight) + fine * weight;
          }
        }
      }
      return { id: patch.hostId, bounds, width: patch.width, height: patch.height, buffer: pixels.buffer };
    });
  }
}
