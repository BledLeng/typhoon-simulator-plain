// Reduced-order, time-evolving synoptic forcing; not a weather forecast.
// The polar stratospheric diagnostic is separate from its weak, lagged
// tropospheric coupling. It is not a giant surface tropical cyclone.
import { longitudeDelta } from './geography.js';
const RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const cache = new WeakMap();

// Seeded synoptic variability: smooth multi-day weather, not per-frame jitter
// or an independent random steering vector for each tropical cyclone.
function synopticNoise(seed, channel, hours, interval) {
  const at = index => {
    let n = (seed | 0) ^ Math.imul(channel + 1, 0x9e3779b9) ^ Math.imul(index, 0x85ebca6b);
    n = Math.imul(n ^ n >>> 16, 0x7feb352d);
    n = Math.imul(n ^ n >>> 15, 0x846ca68b);
    return ((n ^ n >>> 16) >>> 0) / 2147483648 - 1;
  };
  const phase = hours / interval, i = Math.floor(phase), t = phase - i;
  const blend = t * t * t * (t * (6 * t - 15) + 10);
  return at(i) * (1 - blend) + at(i + 1) * blend;
}

export function circulationState(env, hours) {
  const old = cache.get(env);
  if (old?.hours === hours && old.revision === env.revision) return old;
  const day = (env.seasonDay ?? 240) + hours / 24;
  const phase = env.phase ?? 0, mobility = env.ridgeMobility ?? 1;
  const ridges = [], poles = [], troughs = [], belts = [];
  for (const sign of [1, -1]) {
    const season = Math.cos(2 * Math.PI * (day - 220) / 365) * sign;
    // Six periodic longitude nodes describe coherent regional wind belts.
    // Sampling is O(1), rather than searching a second collection of systems
    // at every cloud-grid point. Neighbouring storms share the same weather.
    const nodes = [];
    for (let i = 0; i < 6; i++) {
      const channel = 128 + (sign < 0 ? 48 : 0) + i * 8;
      const noise = (offset, interval) => synopticNoise(env.seed ?? 0, channel + offset, hours, interval);
      nodes.push({
        trade: 8.5 * (1 + mobility * .48 * noise(0, 141)),
        jetLatitude: 33 + season * 2 + mobility * (6 * noise(1, 173) + 2 * noise(2, 67)),
        jet: 26 * (1 + mobility * .3 * noise(3, 113)),
      });
    }
    belts.push(nodes);
    for (const [index, baseLon] of [env.ridgeLongitude ?? 150, 325, 75].entries()) {
      const channel = (index + (sign < 0 ? 3 : 0)) * 16;
      const noise = (offset, interval) => synopticNoise(env.seed ?? 0, channel + offset, hours, interval);
      const baseLat = index === 0 && sign > 0 ? (env.ridgeLatitude ?? 29) : 29;
      const tilt = mobility * .32 * noise(6, 137), cos = Math.cos(tilt), sin = Math.sin(tilt);
      // Sliders set the background state. Each basin's ridge automatically
      // expands/contracts, tilts and retreats on independent synoptic clocks.
      ridges.push({
        lon: baseLon + mobility * (16 * noise(0, 93 + index * 13) + 8 * noise(1, 239)),
        lat: sign * (baseLat + season * 3 + mobility * (6 * noise(2, 117) + 2 * noise(3, 49))),
        amplitude: Math.max(0, (env.ridgePressure ?? 1023) - 1010)
          * Math.max(.2, .85 + mobility * .35 * noise(4, 101)) * (index === 0 ? 1 : .85),
        width: 2400 * (1 + mobility * .25 * noise(5, 149)),
        height: 1400 * (1 + mobility * .2 * noise(7, 127)),
        cos, sin, sign,
      });
      // Intermittent midlatitude troughs open/close a weakness in the ridge;
      // recurvature depends on encountering that weakness, not on a saved path.
      // A trough moves east through the basin during a finite synoptic pass.
      // It fades completely at both ends, so a new pass never teleports a wind
      // anomaly. Depth/strength differ between passes and between basins.
      const period = 156 + index * 23;
      const pass = hours / period + (synopticNoise(env.seed ?? 0, channel + 8, 0, 1) + 1) / 2;
      const cycle = Math.floor(pass), progress = pass - cycle;
      const passageNoise = offset => synopticNoise(env.seed ?? 0, channel + offset, cycle, 1);
      troughs.push({
        lon: baseLon - 70 + progress * 100 + 12 * passageNoise(9),
        lat: sign * (baseLat + 3 + 7 * passageNoise(10)),
        amplitude: mobility * (14 + 7 * passageNoise(11)) * Math.sin(Math.PI * progress) ** 2,
        width: 1450, height: 1250, sign,
      });
    }
    const winter = (1 - season) / 2;
    const strength = (env.polarStrength ?? 1) * (.25 + .75 * winter);
    const phaseAngle = phase + hours / (sign > 0 ? 177 : 240);
    poles.push({ sign, strength, phase: phaseAngle,
      displacement: (env.polarDisplacement ?? 1) * (sign > 0 ? 7 : 3.5),
      latitude: 66 + 4 * (1 - winter),
      coupling: strength * (.8 + .2 * Math.sin((hours - 96) / 180 + phase)),
    });
  }
  const state = { hours, revision: env.revision, ridges, poles, troughs, belts };
  cache.set(env, state);
  return state;
}

export function polarBoundary(pole, longitude) {
  return pole.sign * (pole.latitude + pole.displacement
    * (.65 * Math.sin(longitude * RAD * 2 + pole.phase)
      + .35 * Math.cos(longitude * RAD * 3 - pole.phase * .7)));
}

export function sampleCirculation(env, lon, lat, hours) {
  const state = circulationState(env, hours), sign = lat < 0 ? -1 : 1;
  let high = 0, pressure = 0, u = 0, v = 0, upperU = 0, upperV = 0, closest = null, best = -1;
  for (const ridge of state.ridges) {
    if (ridge.sign !== sign) continue;
    const dx = longitudeDelta(lon, ridge.lon) * Math.cos(lat * RAD) * 111.2;
    const dy = (lat - ridge.lat) * 111.2;
    const x = dx * ridge.cos + dy * ridge.sin, y = -dx * ridge.sin + dy * ridge.cos;
    const shape = Math.exp(-(x * x / ridge.width ** 2 + y * y / ridge.height ** 2));
    const speed = ridge.amplitude * 2.1 * shape;
    pressure += ridge.amplitude * shape; high += shape * ridge.amplitude / 18;
    const ru = sign * speed * (ridge.sin * x / ridge.width + ridge.cos * y / ridge.height);
    const rv = -sign * speed * (ridge.cos * x / ridge.width - ridge.sin * y / ridge.height);
    u += ru; v += rv;
    upperU += ru * .9; upperV += rv * .9;
    if (shape > best) { best = shape; closest = ridge; }
  }
  for (const trough of state.troughs) {
    if (trough.sign !== sign || !trough.amplitude) continue;
    const x = longitudeDelta(lon, trough.lon) * Math.cos(lat * RAD) * 111.2 / trough.width;
    const y = (lat - trough.lat) * 111.2 / trough.height;
    const strength = trough.amplitude * Math.exp(-x * x - y * y);
    pressure -= strength; high -= strength / 18;
    const tu = -sign * strength * 2.4 * y, tv = sign * strength * 2.4 * x;
    u += tu * .35; v += tv * .35;
    upperU += tu * 1.8; upperV += tv * 1.8;
  }
  const pole = state.poles[sign > 0 ? 0 : 1], boundary = Math.abs(polarBoundary(pole, lon));
  const band = Math.exp(-(((Math.abs(lat) - boundary) / 8) ** 2));
  const slope = pole.displacement * RAD * (1.3 * Math.cos(lon * RAD * 2 + pole.phase)
    - 1.05 * Math.sin(lon * RAD * 3 - pole.phase * .7));
  const jet = 22 * pole.coupling * band;
  u += jet; v += jet * slope * sign;
  upperU += jet * 1.4; upperV += jet * slope * sign * 1.4;
  const cold = pole.coupling * Math.exp(-(((Math.abs(lat) - (boundary - 8)) / 9) ** 2))
    * clamp((pole.latitude - boundary) / 7, 0, 1);
  const position = ((lon % 360 + 360) % 360) / 60, i = Math.floor(position);
  const blend = smooth(0, 1, position - i), nodes = state.belts[sign > 0 ? 0 : 1];
  const a = nodes[i], b = nodes[(i + 1) % 6];
  return { high: clamp(high, 0, 1.5), pressure, u, v, upperU, upperV, cold,
    tradeSpeed: a.trade + (b.trade - a.trade) * blend,
    jetLatitude: a.jetLatitude + (b.jetLatitude - a.jetLatitude) * blend,
    jetSpeed: a.jet + (b.jet - a.jet) * blend,
    ridgeLon: closest.lon, ridgeLat: closest.lat, polar: pole.strength * band };
}
