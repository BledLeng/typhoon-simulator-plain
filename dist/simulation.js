// An educational, reduced-order cyclone model. Units: km, hours, m/s, °C, hPa.
// This is not a numerical weather prediction or a source of real forecasts.
import { Ocean } from './ocean.js';
import { evolveBanding } from './eye-morphology.js?v=eye-42';
import { monthlyClimate } from './basin-climate.js';
import { moistureEnvelope } from './moisture-envelope.js';
import { StormNames, namingBasin } from './storm-names.js';
import { StormIdentifiers, trackLabel } from './storm-identifiers.js';
import { wrapLongitude, longitudeDelta, isMediterranean } from './geography.js';
import { environmentEventEffects } from './environment-config.js?v=global-39';
import { sampleCirculation } from './circulation.js?v=global-39';
import { steeringDepth, steeringFlow } from './steering.js?v=global-39';
import { thermalWindCapacity, evolveIntensification } from './intensity.js';
import { tropicalPressureDeficit } from './pressure.js';
import { flaq_eyeTarget, flaq_eyeTrend } from './eye.generated.js';
import { subtropicalSupport, evolveSubtropicalTransition, circulationCoreRadius } from './cyclone-phase.js';
import { applyTerrainDisruption, terrainWindFactor, TERRAIN_SECTORS, TERRAIN_BANDS } from './terrain-interaction.js';
import { toKnots, pacificLongitude, classification, regionalGrade, gradeNote } from './cyclone-grades.js';
export { toKnots, pacificLongitude, classification, regionalGrade, gradeNote, cycloneBasin,
  TYPHOON_GRADES, HURRICANE_GRADES, typhoonGrade } from './cyclone-grades.js';
export { applyTerrainDisruption } from './terrain-interaction.js';
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;
const terrainBearings = Array.from({length:TERRAIN_SECTORS}, (_, sector) => [-.3, 0, .3].map(offset => {
  const angle = (sector + offset) * 360 / TERRAIN_SECTORS * DEG;
  return {sin:Math.sin(angle), cos:Math.cos(angle)};
}));
export const visibleSystem = s => s.kind !== 'cloud' && s.wind >= 7;
export const isHighLatitudeSystem = s => s.kind === 'extratropical' || s.kind === 'anticyclone';
export const systemName = s => s.kind === 'anticyclone' ? '反气旋' : s.kind === 'extratropical' ? '温带气旋'
  : s.kind === 'subtropical' ? regionalGrade(s).name
  : s.forcedLow && toKnots(s.wind) < 28 && !isMediterranean(s.lon, s.lat) ? '低压'
  : classification(s.wind, s.lon, s.lat, s.organization);
export const coriolisParameter = lat => 2 * 7.2921159e-5 * Math.sin(lat * Math.PI / 180);
export const systemLabel = s => s.stormName ? s.stormName + ' · ' + systemName(s) : systemName(s);
export function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function environment(seed) {
  const r = random(seed);
  return {
    seed, enso: r() * 4 - 2, seaTemperature: 28 + r() * 2,
    shear: 4 + r() * 6, humidity: 66 + r() * 18,
    ridgeLongitude: 140 + r() * 18, ridgeLatitude: 26 + r() * 9,
    ridgePressure: 1018 + r() * 9, monsoon: 4 + r() * 9,
    phase: r() * Math.PI * 2, genesisMultiplier: 1,
    coldSurge: r(), mixedLayer: 45 + r() * 65, revision: 0, events: [],
    backgroundPressure: 1009 + r() * 8,
    seasonDay: 240, upperCold: 1, ridgeMobility: 1, polarStrength: 1, polarDisplacement: 1,
  };
}
export function sampleEnvironment(env, lon, lat, hours = 0) {
  lon = pacificLongitude(lon);
  const phase = env.phase + hours / 170;
  const absLat = Math.abs(lat), hemisphere = lat < 0 ? -1 : 1;
  const season = Math.cos(2 * Math.PI * ((env.seasonDay ?? 240) + hours / 24 - 220) / 365) * hemisphere;
  const normal = monthlyClimate(lon, lat, (env.seasonDay ?? 240) + hours / 24);
  const event = environmentEventEffects(env, lon, lat, hours);
  const wave = Math.sin(lon * .13 + lat * .11 + phase);
  const circulation = sampleCirculation(env, lon, lat, hours);
  const { ridgeLon, ridgeLat, high } = circulation;
  const troughLat = hemisphere * (9 + 4 * Math.sin(lon * .025 + phase) + env.enso);
  const monsoonWind = clamp(env.monsoon + event.monsoon * 8, 0, 28);
  const westPacific = Math.exp(-((longitudeDelta(lon, 132 + env.enso * 6) / 30) ** 2));
  const indian = Math.exp(-((longitudeDelta(lon, 75) / 26) ** 2));
  const atlantic = Math.exp(-((longitudeDelta(lon, 320) / 40) ** 2));
  // The Atlantic convergence belt is usually north of the equator. A mirrored
  // permanent southern nursery used to seed systems even in hostile shear.
  const southAtlantic = smooth(0, 9, -lat) * smooth(282, 310, lon)
    * (1 - smooth(348, 375, lon)) + (lon < 20 ? smooth(0, 9, -lat) * (1 - smooth(-12, 15, lon)) : 0);
  const trough = (1 - .8*southAtlantic) * Math.exp(-(((lat - troughLat) / 5) ** 2)) * (.25 + .65 * westPacific + .4 * indian + .3 * atlantic)
    * clamp(monsoonWind / 10, 0, 1.6) * (.65 + .35 * season);
  const itczLat = hemisphere * (7 + 2 * Math.sin(lon * .03 + phase));
  const itcz = (1 - .9*southAtlantic) * Math.exp(-(((lat - itczLat) / 4) ** 2)) * (.35 + .65 * Math.exp(-((longitudeDelta(lon, 248) / 28) ** 2)));
  const cold = (env.coldSurge ?? .3) * smooth(14, 35, lat)
    * Math.exp(-(((lon - 120) / 22) ** 2)) * (.5 + .5 * Math.sin(hours / 90 + phase)) + event.cold + circulation.cold;
  const frontLat = hemisphere * (39 + 8 * Math.sin(lon * .035 - hours / 130 + phase));
  const front = Math.exp(-(((lat - frontLat) / 4) ** 2));
  const mediterranean = isMediterranean(lon, lat);
  const sst = normal.sst !== null ? clamp(normal.sst + (env.seaTemperature - 29)
    + .55 * wave + env.enso * .35 * Math.sin((lon - 140) * DEG * 3), -1.8, 32)
    : mediterranean ? clamp(21 + 5 * season + (env.seaTemperature - 29) + wave * .6, 10, 32)
    : clamp(env.seaTemperature - .018 * Math.max(0, absLat - 12) ** 2
      + season * smooth(5, 25, absLat) + .55 * wave + env.enso * .35 * Math.sin((lon - 140) * DEG * 3), -1.8, 32);
  const shear = clamp(normal.shear + (env.shear - 7)
    + 5 * Math.sin(lon * .17 - lat * .12 + phase) + env.enso * Math.sin(lon * .08) + cold * 14 + event.shear * 18, 1, 45);
  // Regional trade/westerly boundaries move with the synoptic environment;
  // there is no universal latitude at which every storm has to recurve.
  const { tradeSpeed, jetLatitude, jetSpeed } = circulation;
  const u = -tradeSpeed * (1 - smooth(jetLatitude - 13, jetLatitude, absLat))
    + jetSpeed * smooth(jetLatitude - 6, jetLatitude + 12, absLat)
    + circulation.u + 10 * Math.tanh((troughLat - lat) / 4) * trough - cold * 12;
  const v = circulation.v + 1.5 * Math.sin(lon * .12 + phase)
    + (troughLat - lat) * trough * .35 + (itczLat - lat) * itcz * .25 - cold * 20 + (frontLat - lat) * front;
  const upperU = -tradeSpeed * .55 * (1 - smooth(jetLatitude - 16, jetLatitude - 3, absLat))
    + jetSpeed * 1.65 * smooth(jetLatitude - 10, jetLatitude + 9, absLat) + circulation.upperU;
  const upperV = circulation.upperV + (frontLat - lat) * front * 1.25;
  // The deep mean includes the lower layer, not just the upper-level wind.
  const deepU = .35 * u + .65 * upperU, deepV = .35 * v + .65 * upperV;
  const moisture = moistureEnvelope(env.seed, lon, lat, hours, u, v);
  // Moist sectors feed the trough/front while adjacent subsiding air can
  // stay clear; do not impose the same diagonal humidity wave in every basin.
  const humidity = clamp(env.humidity + 38 * (moisture - .5) - 15 * high
    + (trough * 7 + itcz * 6 + front * 20) * (.30 + 1.35 * moisture)
    - cold * 23 + event.moist * 16, 25, 98);
  // Integral of a triangular T(z)-26 profile; rho*Cp/1e7 = 0.409 kJ/cm²/(K m).
  const depth26 = clamp((env.mixedLayer ?? 75) + 34 * Math.sin(lon * .07 + phase)
    + 20 * wave - 25 * smooth(200, 260, lon) + env.enso * 9, 10, 170);
  const ohc = .409 * Math.max(0, sst - 26) * depth26 * .5;
  const basePressure = env.backgroundPressure ?? 1010;
  return { sst, shear, humidity, pressure: basePressure + circulation.pressure - trough * 2 + cold * 3,
    u, v, deepU, deepV, ridgeLon, ridgeLat, high, enso: env.enso, ohc, depth26, trough, cold, itcz, front,
    upperCold: (env.upperCold ?? 1) * (front * 9 + cold * 7), mediterranean,
    polar: circulation.polar, temperature: sst - 1.5 - cold * 8 - front * 2, shearAngle: phase + lon * .025 };
}
export function displacement(a, b) {
  let dlon = b.lon - a.lon;
  dlon = ((dlon + 540) % 360) - 180;
  return { x: dlon * 111.2 * Math.cos((a.lat + b.lat) * .5 * DEG), y: (b.lat - a.lat) * 111.2 };
}
export const distance = (a, b) => { const d = displacement(a, b); return Math.hypot(d.x, d.y); };
export const systemColor = s => isHighLatitudeSystem(s) ? '#207847' : regionalGrade(s)?.color || '#eaf9ff';

export function evolveExtratropicalTransition(s, e, dt) {
  if (s.kind === 'extratropical') { s.transition = 1 - (1 - (s.transition ?? 1)) * Math.exp(-dt / 18); return false; }
  if (s.kind !== 'disturbance') return false;
  const favorable = Math.abs(s.lat) > 25 && e.sst < 26 && e.shear > 12 && s.baroclinicity > .12;
  s.transitionHours = favorable ? (s.transitionHours || 0) + dt : Math.max(0, (s.transitionHours || 0) - dt);
  s.transition = (s.transition || 0) + (Number(favorable) - (s.transition || 0)) * (1 - Math.exp(-dt / (favorable ? 18 : 24)));
  if (s.transitionHours < 12 || s.transition < .85) return false;
  s.kind = 'extratropical';
  return true;
}

// Diagnostic four-quadrant radii (NE, SE, SW, NW), NOT operational CMA data.
// Thresholds are Beaufort 7/10/12; wind here is the model's 1-minute mean.
export function radiusOfMaximumWind(s) {
  return s.coreRadius || equilibriumCoreRadius(s);
}
const equilibriumCoreRadius = s => circulationCoreRadius(s, clamp((75 - s.wind * .7) * clamp((s.radius || 320) / 320, .45, 2), 12, 140));

export function evolveDryIntrusion(s, ambient, upstream, dt) {
  const tropical = s.kind === 'disturbance' || s.kind === 'subtropical';
  const target = tropical ? (1 - smooth(40, 80, upstream.humidity)) * (.25 + .75 * smooth(4, 25, ambient.shear)) : 0;
  s.dryIntrusion = (s.dryIntrusion || 0) + (target - (s.dryIntrusion || 0)) * (1 - Math.exp(-dt / (target > (s.dryIntrusion || 0) ? 6 : 12)));
  s.dryAirHumidity = upstream.humidity;
  s.dryAirAngle = ambient.shearAngle + Math.PI;
}

// Parameterized secondary-eyewall lifecycle, not a resolved 3-D ERC model.
// Only sustained organized, moist convection can build an outer eyewall.
export function evolveEyewalls(s, { support, convection, shear, humidity }, dt) {
  evolveBanding(s, support, convection, shear, humidity, dt);
  const cycle = s.eyewallCycle ||= { phase: 'none', maturity: 0, strength: 0, radius: 0, inner: 1, cooldown: 0 };
  if (s.coreRadius && cycle.phase !== 'merging') s.coreRadius += (equilibriumCoreRadius(s) - s.coreRadius) * (1 - Math.exp(-dt / 72));
  cycle.cooldown = Math.max(0, cycle.cooldown - dt);
  const viable = s.kind === 'disturbance' && !s.absorbedBy && (s.dryIntrusion || 0) < .55 && s.wind > 35 && support > .35
    && convection > .5 && shear < 15 && humidity > 65;
  const mature = viable && s.wind > 45 && s.eye > .25 && s.organization > .6 && s.warmCore > .2;
  if (cycle.phase === 'none') {
    cycle.maturity = mature && !cycle.cooldown ? cycle.maturity + dt : Math.max(0, cycle.maturity - dt * 2);
    const required = 18 + ((s.seed || 0) % 25);
    if (cycle.maturity < required) return;
    cycle.phase = 'forming'; cycle.radius = radiusOfMaximumWind(s) * 2.8;
    cycle.maturity = 0;
  }
  if (!viable) cycle.phase = 'decaying';
  if (cycle.phase === 'decaying') {
    cycle.strength *= Math.exp(-dt / 6);
    cycle.inner += (1 - cycle.inner) * (1 - Math.exp(-dt / 8));
    if (cycle.strength < .01) Object.assign(cycle, { phase: 'none', strength: 0, inner: 1, radius: 0, cooldown: 24 });
    return;
  }
  // A coherent inner wall can survive contact. The two maxima approach a
  // common radius; the outer contribution fades without erasing the inner eye.
  if (cycle.phase === 'merging') {
    const toward = -Math.expm1(-dt / 5);
    s.coreRadius += (cycle.fusedRadius - s.coreRadius) * toward;
    cycle.radius += (cycle.fusedRadius - cycle.radius) * toward;
    cycle.inner += (1 - cycle.inner) * toward;
    cycle.strength *= Math.exp(-dt / 6);
    if (cycle.strength < .04) {
      s.eyewallMergers = (s.eyewallMergers || 0) + 1;
      Object.assign(cycle, { phase: 'none', radius: 0, strength: 0, inner: 1, cooldown: 48 });
    }
    return;
  }
  cycle.strength += (1 - cycle.strength) * (1 - Math.exp(-dt / 10));
  if (cycle.strength > .55) cycle.phase = 'contracting';
  if (cycle.phase === 'contracting') {
    const rmw = radiusOfMaximumWind(s);
    cycle.radius += (rmw * 1.35 - cycle.radius) * (1 - Math.exp(-dt / 18));
    // Use feedback from the resolved core, not a random draw on every tick.
    const retention = smooth(.48, .8, s.coreSymmetry ?? 0) * smooth(.38, .75, s.eye)
      * smooth(.6, .86, convection) * (1 - smooth(6, 15, shear));
    const retainedWall = cycle.radius < rmw * 1.54 && retention < .56 ? 0 : .88 * retention;
    cycle.inner += (Math.max(.1, 1 - cycle.strength, retainedWall) - cycle.inner) * (1 - Math.exp(-dt / 8));
    if (cycle.radius < rmw * 1.8 && cycle.inner > .48 && retention > .48) {
      cycle.phase = 'merging'; s.coreRadius = rmw;
      cycle.fusedRadius = rmw + (cycle.radius - rmw) * cycle.strength / (cycle.strength + cycle.inner);
      return;
    }
    if (cycle.radius < rmw * 1.7 && cycle.inner < .45) {
      s.coreRadius = cycle.radius;
      Object.assign(cycle, { phase: 'none', strength: 0, inner: 1, cooldown: 48 });
      s.eyewallReplacements = (s.eyewallReplacements || 0) + 1;
    }
  }
}
export function windRadii(s) {
  if (s.windEnvelope) return s.windEnvelope;
  return diagnosedWindRadii(s);
}
function diagnosedWindRadii(s) {
  const rmw = radiusOfMaximumWind(s);
  return [13.9, 24.5, 32.7].map(threshold => [45, 135, 225, 315].map(bearing => {
    const angle = bearing * DEG;
    // Environmental circulation has its own memory. Cursor guidance changes
    // trajectory, not the existing wind envelope in that same frame.
    const translation = clamp(((s.windFieldU || 0) * Math.cos(angle) - (s.windFieldV || 0) * Math.sin(angle)) / 3.6 * .3, -2.5, 2.5);
    const peak = Math.max(0, s.wind + translation);
    if (peak < threshold) return 0;
    const radius = rmw * (peak / threshold) ** (1 / .65);
    return Math.min(800, radius * terrainWindFactor(s, angle, radius) ** (1 / .65));
  }));
}
export function evolveWindEnvelope(s, u, v, dt) {
  const follow = 1 - Math.exp(-dt / 6);
  s.windFieldU = (s.windFieldU || 0) + (u - (s.windFieldU || 0)) * follow;
  s.windFieldV = (s.windFieldV || 0) + (v - (s.windFieldV || 0)) * follow;
  const target = diagnosedWindRadii(s);
  if (!s.windEnvelope) s.windEnvelope = target;
  else target.forEach((ring, i) => ring.forEach((r, q) => { s.windEnvelope[i][q] += (r - s.windEnvelope[i][q]) * follow; }));
}
export function eyePotential(s, shear, humidity, transition = 0) {
  const replacement = 1 - .65 * (s.eyewallCycle?.strength || 0) * (1 - (s.eyewallCycle?.inner ?? 1));
  return flaq_eyeTarget(s.wind,s.warmCore,s.organization,shear,humidity,
    s.coreSymmetry ?? 0,s.coreCloud ?? 1,s.dryIntrusion || 0,
    (1-transition)*(1-(s.subtropicality ?? Number(s.kind === 'subtropical'))),replacement,
    s.eyeTrend ?? 0,s.eye ?? 0);
}

export function evolveCoreStructure(s, dt) {
  if (Number.isFinite(s.fieldCoreSymmetry)) {
    const old = s.coreSymmetry ?? 0;
    s.coreSymmetry = old + (s.fieldCoreSymmetry - old) * (1 - Math.exp(-dt / (s.fieldCoreSymmetry > old ? 6 : 2)));
  } else if (s.coreSymmetry != null) s.coreSymmetry *= Math.exp(-dt / 8);
  if (Number.isFinite(s.fieldCoreCloud)) {
    const old = s.coreCloud ?? 1;
    s.coreCloud = old + (s.fieldCoreCloud - old) * (1 - Math.exp(-dt / 2));
  }
}
export function centralPressure(s, ambientPressure) {
  if (s.kind === 'anticyclone') return ambientPressure + s.wind * .5;
  return ambientPressure - tropicalPressureDeficit(s, radiusOfMaximumWind(s));
}

// Reduced-order tropical transition: upper cold air can sustain convection over
// Mediterranean SSTs below the tropical threshold. It is not a warm-water override.
export function medicaneSupport(e) {
  return e.mediterranean ? smooth(16, 24, e.sst) * smooth(3, 10, e.upperCold || 0)
    * smooth(48, 82, e.humidity) * (1 - smooth(12, 28, e.shear)) : 0;
}

export function destination(lon, lat, bearing, km) {
  const a = km / 6371, b = bearing * DEG, p = lat * DEG;
  const q = Math.asin(Math.sin(p) * Math.cos(a) + Math.cos(p) * Math.sin(a) * Math.cos(b));
  return { lon: lon + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(p), Math.cos(a) - Math.sin(p) * Math.sin(q)) / DEG, lat: q / DEG };
}

export class Simulation {
  constructor(seed, isLand = () => false, elevation = () => 0) {
    this.seed = seed >>> 0; this.rng = random(this.seed); this.env = environment(this.seed);
    this.hours = 0; this.systems = []; this.nextId = 1; this.selectedId = null;
    this.identifiers = new StormIdentifiers(this.env.seasonDay);
    this.heading = null; this.isLand = isLand; this.pairs = new Map(); this.events = [];
    this.ocean = new Ocean(isLand); this.landfalls = []; this.landSamples = new Map();
    this.footprints = new Map(); this.genesisHistory = []; this.lastCandidateCleanup = -Infinity;
    this.elevation = elevation; this.terrainSamples = new Map();
    this.completed = [];
    this.names = new StormNames(random(this.seed ^ 0x4e414d45));
  }
  add(kind, lon, lat, options = {}) {
    if (!['cloud', 'disturbance', 'subtropical', 'extratropical', 'anticyclone'].includes(kind)) throw new Error('Unknown system type');
    if (this.systems.length >= 160) return null;
    const r = this.rng;
    const system = {
      id: this.nextId++, seed: (r() * 4294967296) >>> 0, kind,
      lon: pacificLongitude(lon), lat: clamp(lat, -85, 85), age: 0,
      wind: kind === 'cloud' ? 2 + r() * 3 : 7 + r() * 3,
      organization: kind === 'cloud' ? .05 + r() * .1 : .25 + r() * .15,
      radius: kind === 'cloud' ? 180 + r() * 200 : 140 + r() * 360,
      moisture: .65 + r() * .2, coldWake: 0, pressure: 1008, rotation: r() * 6.28,
      u: 0, v: 0, speed: 0, fuji: 0, trail: [], lastTrail: -1, merged: false,
      incubation: 0, genesisThreshold: 2 - Math.log(1 - r()) * 40, vorticity: .25 + r() * .75, favorableHours: 0,
      fieldVorticity: 0, fieldConvergence: 0, landEnergy: 0,
      convection: 0, fieldHumidity: null, eye: 0, warmCore: 0, injected: true,
      ...options,
    };
    system.birthRadius = options.birthRadius ?? system.radius;
    if (kind === 'extratropical' || kind === 'anticyclone') {
      system.wind = options.wind ?? (kind === 'extratropical' ? 18 : 12);
      system.radius = options.radius ?? 600; system.organization = options.organization ?? .65;
      system.injected = false;
    }
    if (kind === 'subtropical') {
      system.wind = options.wind ?? 18; system.organization = options.organization ?? .5;
      system.radius = options.radius ?? 380; system.birthRadius = options.birthRadius ?? system.radius;
      system.subtropicality = 1; system.warmCore = options.warmCore ?? .12;
      system.transition = 0;
    }
    system.pressure = options.pressure ?? centralPressure(system, this.environmentAt(system.lon, system.lat).pressure);
    this.trackExtrema(system);
    this.systems.push(system); return system;
  }
  trackExtrema(s) {
    if (s.kind === 'disturbance' || s.kind === 'subtropical') {
      this.identifiers.update(s,this.systems,this.hours);
      if (!s.stormName && toKnots(s.wind) + 1e-10 >= 34) {
        s.namingBasin = namingBasin(s.lon, s.lat);
        s.stormName = this.names.draw(s.namingBasin, new Set(this.systems.map(other => other.stormName)));
      }
      // A cloud candidate may exist for days before cyclogenesis. Its nursery
      // age is not part of the ranked cyclone's lifetime.
      s.tropicalStartHour ??= this.hours;
      s.wasTropical = true;
    }
    if (!s.wasTropical) return;
    if (s.peakWind === undefined || s.wind > s.peakWind) {
      s.peakWind = s.wind; s.peakLon = s.lon; s.peakLat = s.lat; s.peakKind = s.kind;
    }
    s.minimumPressure = Math.min(s.minimumPressure ?? Infinity, s.pressure);
  }
  finishSystem(s, reason) {
    if (!s.wasTropical || !s.trackStage || this.completed.some(row => row.id === s.id)) return;
    this.trackExtrema(s);
    this.completed.push(Object.freeze({ id: s.id, displayNumber: s.displayNumber,
      trackCode:s.trackCode, lastInvestCode:s.lastInvestCode,
      stormName: s.stormName, namingBasin: s.namingBasin,
      name: s.peakKind === 'subtropical' ? regionalGrade({ kind:s.peakKind, wind:s.peakWind }).name : classification(s.peakWind, s.peakLon, s.peakLat, 1),
      gradeColor: regionalGrade({ kind:s.peakKind, wind: s.peakWind, lon: s.peakLon, lat: s.peakLat }).color,
      gradeNote: gradeNote({ kind:s.peakKind, lon: s.peakLon, lat: s.peakLat }),
      peakWind: s.peakWind, peakKnots: Math.round(toKnots(s.peakWind)),
      minimumPressure: s.minimumPressure, startHour: s.tropicalStartHour ?? this.hours - s.age,
      endHour: this.hours, reason }));
  }
  get rankings() {
    return this.completed.toSorted((a, b) => b.peakKnots - a.peakKnots
      || a.minimumPressure - b.minimumPressure || a.id - b.id);
  }
  populate() {
    // Cloud water already fills the atmospheric mesh. Only actual convergent,
    // rotating cloud maxima may create candidates; no preinstalled tropical grid.
    this.add('extratropical', 170 + this.rng() * 70, 43 + this.rng() * 12);
    this.add('anticyclone', 115 + this.rng() * 40, 43 + this.rng() * 12);
    this.add('extratropical', 300 + this.rng() * 40, -43 - this.rng() * 12);
  }
  select(id) {
    this.selectedId = this.systems.some(s => s.id === id && visibleSystem(s)) ? id : null;
    this.heading = null;
  }
  // No speed argument: cursor distance can never accelerate a storm.
  steer(x, y) { if (this.selectedId !== null && Math.hypot(x, y) > 1e-6) this.heading = Math.atan2(y, x); }
  release() { this.selectedId = null; this.heading = null; }
  environmentAt(lon, lat) {
    const e = sampleEnvironment(this.env, lon, lat, this.hours);
    const cooling = this.ocean.sample(lon, lat, this.hours);
    return { ...e, sst: e.sst - cooling, ohc: Math.max(0, e.ohc - .409 * cooling * e.depth26 * .5), cooling };
  }
  landAt(s) {
    const sample = this.landSamples.get(s.id);
    if (sample && distance(s, sample) < (s.kind === 'cloud' ? 20 : 3)) return sample.land;
    const land = this.isLand(s.lon, s.lat);
    this.landSamples.set(s.id, { lon: s.lon, lat: s.lat, land });
    return land;
  }
  landFraction(s) {
    const old = this.footprints.get(s.id);
    if (old && distance(s, old) < 12 && Math.abs(old.radius - s.radius) < 20) return old.fraction;
    let fraction = this.isLand(s.lon, s.lat) ? .2 : 0;
    const radius = clamp(s.radius * .45, 65, 220);
    for (let angle = 0; angle < 360; angle += 45) {
      const point = destination(s.lon, s.lat, angle, radius);
      if (this.isLand(point.lon, point.lat)) fraction += .1;
    }
    this.footprints.set(s.id, { lon: s.lon, lat: s.lat, radius: s.radius, fraction });
    return fraction;
  }
  terrainAt(s) {
    const rmw = radiusOfMaximumWind(s);
    const old = this.terrainSamples.get(s.id), radius = clamp(Math.max(rmw * 3, s.radius * 1.1), 100, 480);
    if (old && distance(s, old) < 6 && Math.abs(radius - old.radius) < 6 && Math.abs(rmw - old.rmw) < 3) return old;
    let blocking = 0, peak = 0;
    const sample = (lon, lat) => {
      // Most quadrature points are over water. Avoid a full coastline polygon
      // hit test unless the DEM can actually supply a significant barrier.
      const elevation = this.elevation(lon, lat);
      const height = elevation > 300 && this.isLand(lon, lat) ? elevation : 0;
      peak = Math.max(peak, height); return smooth(300, 2500, height);
    };
    const center = sample(s.lon, s.lat), sectors = [], bands = [];
    // Radial quadrature resolves a mountain range crossing just one part of the
    // circulation. Centre need not be over land. Sample only after ~6 km motion.
    const sinLat = Math.sin(s.lat * DEG), cosLat = Math.cos(s.lat * DEG);
    const shells = Array.from({length:TERRAIN_BANDS}, (_, ring) => {
      const r = radius * (ring + .5) / TERRAIN_BANDS;
      return {weight:r * Math.exp(-.5 * (r / (rmw * 1.6)) ** 2),
        ridgeWeight:Math.exp(-.5 * (r / (rmw * 2.5)) ** 2),
        arcs:[-.25, .25].map(along => {
          const a = radius * (ring + .5 + along) / TERRAIN_BANDS / 6371;
          return {sin:Math.sin(a), cos:Math.cos(a)};
        })};
    });
    for (const bearings of terrainBearings) {
      let sum = 0, weight = 0, ridge = 0;
      for (const shell of shells) {
        let average = 0, strongest = 0;
        // A narrow ridge should not disappear between two radial rays. Area
        // samples retain both the broad barrier and a subcell ridge signal.
        for (const b of bearings) for (const a of shell.arcs) {
          const q = Math.asin(sinLat * a.cos + cosLat * a.sin * b.cos);
          const lon = s.lon + Math.atan2(b.sin * a.sin * cosLat, a.cos - sinLat * Math.sin(q)) / DEG;
          const barrier = sample(lon, q / DEG);
          average += barrier / 6; strongest = Math.max(strongest, barrier);
        }
        bands.push(.6 * strongest + .4 * average);
        sum += shell.weight * average; weight += shell.weight;
        ridge = Math.max(ridge, strongest * shell.ridgeWeight);
      }
      const average = sum / weight;
      sectors.push(.15 * center + .85 * (.7 * average + .3 * ridge));
      blocking += (.15 * center + .85 * average) / TERRAIN_SECTORS;
    }
    const result = { lon: s.lon, lat: s.lat, radius, rmw, blocking, peak, sectors, bands };
    this.terrainSamples.set(s.id, result); return result;
  }
  consolidateCandidates() {
    const clouds = this.systems.filter(s => s.kind === 'cloud' && !s.injected)
      .sort((a, b) => b.organization - a.organization || b.convection - a.convection || a.id - b.id);
    const kept = [], removed = new Set();
    for (const s of clouds) {
      if (kept.some(other => distance(s, other) < 350)) removed.add(s.id);
      else kept.push(s);
    }
    // Removing duplicate tracking records never removes water from the cloud field.
    this.systems = this.systems.filter(s => !removed.has(s.id));
  }
  detectLandfall(s, land, dt) {
    // Strict notification debounce, independent of continuous land energy loss.
    // Start-on-land is not a crossing. Tiny coastal clips do not emit a hit.
    const track = s.landfallTrack ||= { wasLand: land, armed: !land, wetHours: 0, landHours: 0, km: 0, lon: s.lon, lat: s.lat };
    const moved = distance(s, track);
    if (land) {
      if (!track.wasLand) { track.entry = { lon: s.lon, lat: s.lat, hour: this.hours }; track.landHours = 0; track.km = 0; }
      track.wetHours = 0; track.landHours += dt; track.km += moved;
      if (track.armed && track.entry && track.landHours >= .5 && track.km >= 15 && visibleSystem(s) && !isHighLatitudeSystem(s)) {
        const hit = { ...track.entry, id: s.id, displayNumber: s.displayNumber, trackCode:s.trackCode, wind: s.wind };
        this.landfalls.push(hit); if (this.landfalls.length > 60) this.landfalls.shift();
        this.events.push({ hour: this.hours, message: `${trackLabel(s)} 登陆 · ${Math.round(toKnots(s.wind))} kt` });
        track.armed = false;
      }
    } else {
      track.wetHours += dt; track.landHours = 0; track.km = 0;
      if (track.wetHours >= 3) track.armed = true;
    }
    track.wasLand = land; track.lon = s.lon; track.lat = s.lat;
  }
  advance(hours) {
    if (!Number.isFinite(hours) || hours < 0 || hours > 12) throw new RangeError('Invalid simulation interval');
    const steps = Math.ceil(hours / (1 / 12));
    for (let i = 0; i < steps; i++) this.step(hours / steps);
  }
  step(dt) {
    this.hours += dt;
    if (this.hours - this.lastCandidateCleanup >= 3) { this.consolidateCandidates(); this.lastCandidateCleanup = this.hours; }
    const established = this.systems.filter(s => s.kind !== 'cloud' && s.wind >= 7);
    const states = this.systems.map(s => {
      this.trackExtrema(s);
      const e = this.environmentAt(s.lon, s.lat);
      const land = this.landAt(s);
      const landFraction = s.kind === 'cloud' ? Number(land) : this.landFraction(s);
      s.landFraction = landFraction;
      if (s.kind !== 'cloud') this.detectLandfall(s, land, dt);
      s.wasLand = land;
      if (!land) this.ocean.stir(s, e, dt, this.hours);
      s.coldWake = e.cooling;
      const med = medicaneSupport(e), hybrid = subtropicalSupport(s, e);
      const heat = Math.max(smooth(25.5, 29.5, e.sst), med, s.kind === 'subtropical' ? hybrid : 0);
      if (s.kind !== 'cloud') {
        const north = this.environmentAt(s.lon, Math.min(70, s.lat + 2));
        const south = this.environmentAt(s.lon, Math.max(-83, s.lat - 2));
        s.baroclinicity = smooth(1, 8, Math.abs(north.temperature - south.temperature));
        if (evolveSubtropicalTransition(s, e, dt)) {
          this.events.push({ hour:this.hours, message:`${trackLabel(s)} 转为${systemName(s)}` });
        }
        if (med < .2 && evolveExtratropicalTransition(s, e, dt)) {
          this.events.push({ hour: this.hours, message: `${trackLabel(s)} 转为温带气旋` });
        }
      }
      const humidity = s.fieldHumidity === null ? e.humidity : .5 * e.humidity + .5 * s.fieldHumidity;
      const moisture = smooth(43, 85, humidity);
      const shearSupport = 1 - smooth(7, 27, e.shear);
      const coriolis = smooth(5e-6, 2.3e-5, Math.abs(coriolisParameter(s.lat)));
      const brown = clamp(s.landEnergy || 0, 0, 1) * shearSupport;
      const support = heat * moisture * shearSupport * coriolis * (1 - clamp(e.high * .5, 0, .8))
        * (.55 + .45 * smooth(10, 90, e.ohc)) * (1 - landFraction * (.92 - .5 * brown));
      const convection = smooth(.08, .75, s.convection);
      const medTarget = med * convection * s.organization;
      s.medicanelike = (s.medicanelike || 0) + (medTarget - (s.medicanelike || 0)) * (1 - Math.exp(-dt / 12));
      const sourceDistance = s.radius * 1.5;
      const upstream = this.environmentAt(
        s.lon - Math.cos(e.shearAngle) * sourceDistance / (111 * Math.max(.3, Math.cos(s.lat * DEG))),
        clamp(s.lat - Math.sin(e.shearAngle) * sourceDistance / 111, -83, 83));
      evolveDryIntrusion(s, e, upstream, dt);
      evolveEyewalls(s, { support, convection, shear: e.shear, humidity }, dt);
      const response = evolveIntensification(s, e, { support, convection, humidity, landFraction }, dt);
      const targetOrganization = clamp(support * (.15 + 1.1 * convection), 0, 1);
      s.organization += (targetOrganization - s.organization) * (1 - Math.exp(-dt / (targetOrganization > s.organization ? response.organizationHours : 12)));
      s.moisture += (moisture - s.moisture) * (1 - Math.exp(-dt / 10));
      // Probability multiplier changes incubation, never bypasses environmental gates.
      const cyclonic = Math.sign(s.lat) * s.fieldVorticity;
      const rotation = smooth(.5e-6, 5e-6, cyclonic);
      const convergent = smooth(1e-7, 3e-6, s.fieldConvergence);
      const occupied = s.kind === 'cloud' && (established.some(other => distance(s, other) < Math.max(450, other.radius * 1.6))
        || this.genesisHistory.some(other => this.hours - other.hour < 36 && distance(s, other) < 650));
      const fertile = support > .25 && convection > .35 && rotation > .15 && convergent > .1 && e.shear < 19 && !land && !occupied;
      s.favorableHours = fertile ? s.favorableHours + dt : Math.max(0, s.favorableHours - dt * 2);
      s.incubation *= Math.exp(-dt / 72);
      s.incubation = Math.max(0, s.incubation + dt * (fertile
        ? support * convection * rotation * convergent * clamp(this.env.genesisMultiplier, .25, 4) : -.3));
      if (s.kind === 'cloud' && s.favorableHours >= 24 && s.incubation > s.genesisThreshold && s.organization > .45) {
        s.kind = 'disturbance'; established.push(s);
        this.genesisHistory.push({ lon: s.lon, lat: s.lat, hour: this.hours });
      }
      const thermalCapacity = thermalWindCapacity(e, s.lat);
      s.thermalCapacity = thermalCapacity;
      let potential = s.absorbedBy ? 0 : s.kind === 'cloud' ? 2 + 3 * support
        : 5 + Math.max(0, thermalCapacity - 5) * Math.sqrt(support) * s.organization * (.12 + .88 * convection);
      const transition = s.transition ?? (s.kind === 'extratropical' ? 1 : 0);
      const baroclinicPotential = 7 + 43 * s.baroclinicity * smooth(5, 25, e.shear) * smooth(30, 80, humidity);
      if (transition > 0) potential += (baroclinicPotential - potential) * transition;
      if (s.kind === 'subtropical') potential = Math.max(potential,
        5 + 33 * Math.sqrt(hybrid) * s.organization * (.3 + .7 * convection));
      if (s.kind === 'anticyclone') potential = 7 + 15 * clamp(e.high + e.cold * .5, 0, 1);
      if (s.kind === 'disturbance') potential *= 1 - .16 * s.eyewallCycle.strength * (1 - s.eyewallCycle.inner);
      if (s.kind === 'disturbance') potential *= 1 - .12 * s.dryIntrusion;
      if (landFraction > .7) potential = Math.min(potential, s.wind + 3 * brown);
      const windBefore = s.wind;
      const timescale = potential > s.wind ? response.windHours : 24 - landFraction * 10;
      s.wind += (potential - s.wind) * (1 - Math.exp(-dt / timescale));
      s.wind *= Math.exp(-dt * landFraction / 60);
      if (s.kind !== 'cloud' && s.kind !== 'anticyclone') applyTerrainDisruption(s, this.terrainAt(s), dt);
      // The target and finite-rate integration bound growth. Never clip every
      // basin/environment to the old arbitrary 86 m/s (~167 kt) ceiling.
      s.wind = Math.max(1, s.wind);
      s.eyeTrend = flaq_eyeTrend(s.eyeTrend ?? 0,s.wind-windBefore,dt);
      // Prognostic warm core and eye clearing. Strong winds alone do not create an eye.
      const coreTarget = Math.max(support, s.kind === 'subtropical' ? hybrid * .65 : 0)
        * convection * s.organization * (1 - smooth(8, 24, e.shear)) * (1 - transition);
      s.warmCore += (coreTarget - s.warmCore) * (1 - Math.exp(-dt / 14));
      evolveCoreStructure(s, dt);
      const eyeTarget = eyePotential(s, e.shear, humidity, transition);
      s.eye += (eyeTarget - s.eye) * (1 - Math.exp(-dt / (eyeTarget > s.eye ? 13 : 4)));
      if (s.kind === 'extratropical' || s.kind === 'anticyclone') {
        s.eye *= Math.exp(-dt / 2); s.warmCore *= Math.exp(-dt / 8);
        s.organization += (.65 - s.organization) * (1 - Math.exp(-dt / 8));
      }
      s.pressure = centralPressure(s, e.pressure);
      this.trackExtrema(s);
      s.weakHours = s.wind < 7 && s.organization < .18 ? (s.weakHours || 0) + dt : 0;
      // Reduced-order size tendency, not an empirical intensity-to-size law.
      // Remember the seed circulation; moisture and broad monsoon inflow evolve
      // its outer extent slowly. Equal peak winds need not imply equal size.
      s.birthRadius ??= s.radius;
      const sizeEnvironment = .8 + .3 * smooth(40, 90, humidity) + .2 * clamp(e.trough || 0, 0, 1);
      const maturation = 1 + .12 * (1 - Math.exp(-s.age / 96));
      const tropicalRadius = clamp(s.birthRadius * sizeEnvironment * maturation, s.customRadius ? 70 : 100, s.customRadius ? 3200 : 700);
      const targetRadius = s.kind === 'anticyclone' ? 650 : tropicalRadius + (650 - tropicalRadius) * transition;
      s.radius += (targetRadius - s.radius) * (1 - Math.exp(-dt / 35));
      s.rotation += dt * (.025 + s.wind * .004) * (s.lat >= 0 ? 1 : -1);
      s.age += dt; s.fuji = 0;
      if (s.kind === 'cloud' && Number.isFinite(s.cloudU) && Number.isFinite(s.cloudV)) {
        return { s, e, u: s.cloudU, v: s.cloudV, support, land, followsCloudWind: true };
      }
      // Beta drift is modest and only grows with an organized circulation.
      const planetaryBeta = 2 * 7.2921159e-5 * Math.cos(s.lat * DEG) / 6371000;
      const beta = s.kind === 'cloud' ? 0 : Math.min(4, planetaryBeta * (s.radius * 700) ** 2 * 3.6) * s.organization * coriolis;
      const depth = steeringDepth(s);
      s.steeringDepth = (s.steeringDepth ?? depth) + (depth - (s.steeringDepth ?? depth)) * (1 - Math.exp(-dt / 6));
      const steering = steeringFlow(s, e, s.steeringDepth);
      return { s, e, u: steering.u - beta, v: steering.v + Math.sign(s.lat) * beta, support, land };
    });
    const livePairs = new Set();
    // High-pressure cells steer neighbouring lows without cyclone merger logic.
    const highs = states.filter(b => b.s.kind === 'anticyclone');
    for (const a of states) for (const b of highs) {
      if (a === b || a.followsCloudWind) continue; // already included in the moisture solver
      const d = displacement(b.s, a.s), r = Math.hypot(d.x, d.y), radius = b.s.radius;
      const flow = b.s.wind * 2 * Math.exp(-r * r / (2 * radius * radius)) / Math.max(80, r);
      a.u += Math.sign(b.s.lat) * d.y * flow; a.v -= Math.sign(b.s.lat) * d.x * flow;
    }
    const vortices = states.filter(({ s }) => s.kind !== 'cloud' && s.kind !== 'anticyclone' && (s.wind >= 17.5 || s.absorbedBy));
    for (let i = 0; i < vortices.length; i++) for (let j = i + 1; j < vortices.length; j++) {
      const a = vortices[i], b = vortices[j];
      if (a.s.kind === 'cloud' || b.s.kind === 'cloud' || a.s.lat * b.s.lat < 0) continue;
      const d = displacement(a.s, b.s), range = Math.hypot(d.x, d.y);
      const reach = clamp((a.s.radius + b.s.radius) * 1.85, 550, 1450);
      const key = `${a.s.id}:${b.s.id}`;
      if (range > reach * 1.25) continue;
      livePairs.add(key);
      const pair = this.pairs.get(key) || { coupling: 0, contact: 0 };
      const coherent = Math.sqrt(a.s.organization * b.s.organization)
        * smooth(17.5, 35, Math.min(a.s.wind, b.s.wind));
      const proximity = 1 - smooth(reach * .32, reach, range);
      const differentialFlow = Math.hypot(a.e.u - b.e.u, a.e.v - b.e.v);
      const target = coherent * proximity * (1 - .7 * smooth(12, 40, differentialFlow));
      // Gradual spin-up (8 h), not an on/off radius or an instantaneous tether.
      pair.coupling += (target - pair.coupling) * (1 - Math.exp(-dt / 8));
      this.pairs.set(key, pair);
      const core = Math.max(70, (a.s.radius + b.s.radius) * .16);
      const overlap = 1 - smooth(core, core * 2.5, range);
      if (overlap > 0) {
        const weak = a.s.wind * a.s.radius < b.s.wind * b.s.radius ? a.s : b.s;
        const strong = weak === a.s ? b.s : a.s;
        const contrast = 1 - weak.wind * weak.radius / Math.max(1, strong.wind * strong.radius);
        const strain = overlap * pair.coupling * contrast * dt / 12;
        weak.organization *= Math.exp(-strain); weak.eye *= Math.exp(-strain * 3);
      }
      const denominator = range * range + core * core;
      const sign = a.s.lat >= 0 ? 1 : -1;
      const ca = a.s.wind * 3.6 * clamp(75 - a.s.wind * .7, 18, 75) * .65 * pair.coupling;
      const cb = b.s.wind * 3.6 * clamp(75 - b.s.wind * .7, 18, 75) * .65 * pair.coupling;
      // Mutually induced finite-core vortices; stronger circulation dominates.
      a.u += sign * cb * d.y / denominator; a.v -= sign * cb * d.x / denominator;
      b.u -= sign * ca * d.y / denominator; b.v += sign * ca * d.x / denominator;
      // Very close coherent vortices may converge, but never pull at long range.
      const convergence = (1 - smooth(core, core * 2.2, range)) * pair.coupling
        * (.12 + .15 * Math.min(a.support, b.support));
      a.u += cb * d.x / denominator * convergence; a.v += cb * d.y / denominator * convergence;
      b.u -= ca * d.x / denominator * convergence; b.v -= ca * d.y / denominator * convergence;
      a.s.fuji = Math.max(a.s.fuji, pair.coupling); b.s.fuji = Math.max(b.s.fuji, pair.coupling);
      const absorbing = a.s.absorbedBy === b.s.id || b.s.absorbedBy === a.s.id;
      pair.contact = range < core * .8 && (pair.coupling > .2 || absorbing) ? pair.contact + dt : Math.max(0, pair.contact - dt);
      // Sustained core overlap is necessary; merely being nearby never merges.
      if (pair.contact > 6 && !a.s.merged && !b.s.merged) {
        const [large, small] = b.s.absorbedBy === a.s.id ? [a.s, b.s]
          : a.s.absorbedBy === b.s.id ? [b.s, a.s]
          : a.s.wind * a.s.radius >= b.s.wind * b.s.radius ? [a.s, b.s] : [b.s, a.s];
        // Transfer circulation gradually; disrupted structure can weaken during merger.
        const fraction = 1 - Math.exp(-dt / 5);
        const area = large.radius ** 2, transferredArea = small.radius ** 2 * fraction;
        large.radius = Math.min(700, Math.sqrt(area + transferredArea));
        large.wind = (large.wind * area + small.wind * transferredArea * .65) / (area + transferredArea);
        large.organization *= 1 - fraction * .04;
        large.eye *= 1 - fraction * .25;
        small.wind *= 1 - fraction; small.radius *= Math.sqrt(1 - fraction);
        small.absorbedBy = large.id;
        if (small.wind < 7 || small.radius < 50) {
          small.merged = true;
          if (this.selectedId === small.id) this.select(large.id);
          this.events.push({ hour: this.hours, message: `${trackLabel(small)} 环流并入 ${trackLabel(large)}` });
        }
      }
    }
    for (const key of this.pairs.keys()) if (!livePairs.has(key)) this.pairs.delete(key);
    for (const state of states) {
      const { s } = state;
      let { u, v } = state;
      const speed = Math.hypot(u, v);
      evolveWindEnvelope(s, u, v, dt);
      if (s.id === this.selectedId && this.heading !== null) {
        const current = Math.hypot(s.u, s.v) > .1 ? Math.atan2(s.v, s.u) : Math.atan2(v, u);
        const difference = Math.atan2(Math.sin(this.heading - current), Math.cos(this.heading - current));
        const heading = current + difference * (1 - Math.exp(-dt / .8));
        u = Math.cos(heading) * speed; v = Math.sin(heading) * speed;
      }
      s.u = u; s.v = v; s.speed = speed;
      s.lon = pacificLongitude(s.lon + u * dt / (111.2 * Math.max(.1, Math.cos(s.lat * DEG))));
      s.lat += v * dt / 111.2;
      if (s.kind !== 'cloud' && this.hours - s.lastTrail >= .5) {
        s.trail.push([s.lon, s.lat, s.wind]); s.lastTrail = this.hours;
        if (s.trail.length > 240) s.trail.shift();
      }
    }
    this.systems = this.systems.filter(s => {
      const reason = s.merged ? '并入其他环流' : Math.abs(s.lat) > 85 ? '移出模拟纬度'
        : s.wasTropical && s.age > 36 && s.weakHours >= 18 ? '消散'
        : s.age > 60 && s.wind < 3 && s.organization < .1 ? '消散' : null;
      if (!reason) return true;
      // Leaving the Mercator domain is not a completed lifecycle. Do not grant
      // a leaderboard entry just because a system crossed a rendering limit.
      if (reason !== '移出模拟纬度') this.finishSystem(s, reason);
      return false;
    });
    if (!this.systems.some(s => s.id === this.selectedId)) this.release();
    if (this.events.length > 12) this.events.shift();
    this.genesisHistory = this.genesisHistory.filter(s => this.hours - s.hour < 36);
    const ids = new Set(this.systems.map(s => s.id));
    for (const cache of [this.landSamples, this.footprints, this.terrainSamples]) for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  }
  snapshot() {
    // No cloud pixels or frame history: a small seed/parameter/state snapshot.
    return { version: 2, seed: this.seed, hours: this.hours, environment: this.env,
      ocean: this.ocean.snapshot(this.hours), landfalls: this.landfalls, completed: this.completed,
      systems: this.systems.map(({ trail, ...s }) => ({ ...s, trail: trail.slice(-80) })) };
  }
}
