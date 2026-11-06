import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, environment, sampleEnvironment, systemName } from '../dist/simulation.js';
import { setEnvironmentValue, startEnvironmentEvent, environmentEventEffects } from '../dist/environment-config.js';
import { MoistAtmosphere } from '../dist/cloud-field.js';
import { CloudDetails } from '../dist/cloud-detail.js';

test('controls validate/clamp; events ramp, expire, and act locally', () => {
  const env = environment(42);
  assert.equal(setEnvironmentValue(env, 'shear', NaN), false);
  assert.equal(setEnvironmentValue(env, 'unknown', 1), false);
  setEnvironmentValue(env, 'genesisMultiplier', 0); assert.equal(env.genesisMultiplier, .25);
  setEnvironmentValue(env, 'shear', 100); assert.equal(env.shear, 40);
  assert.ok(startEnvironmentEvent(env, 'shear', 0, { lon: 140, lat: 15, intensity: 2, duration: 24 }));
  assert.equal(environmentEventEffects(env, 140, 15, 0).shear, 0);
  assert.equal(environmentEventEffects(env, 140, 15, 24).shear, 0);
  assert.ok(environmentEventEffects(env, 140, 15, 6).shear > environmentEventEffects(env, 270, 15, 6).shear * 100);
  assert.ok(sampleEnvironment(env, 140, 15, 6).shear > sampleEnvironment({ ...env, events: [] }, 140, 15, 6).shear);
});

test('candidate IDs never leak into visible storm numbering', () => {
  const sim = new Simulation(42);
  for (let i = 0; i < 1200; i++) { sim.add('cloud', 140, 15); sim.systems.length = 0; }
  const a = sim.add('disturbance', 140, 15), b = sim.add('disturbance', 160, 15);
  assert.ok(a.id > 1000); assert.equal(a.trackCode, '90W'); assert.equal(b.trackCode, '91W');
  a.wind=20; sim.trackExtrema(a); assert.equal(a.trackCode,'01W');
});

test('probability multiplier affects genesis without bypassing 24h organization or rotation', () => {
  const results = [.25, 1, 4].map(multiplier => {
    const sim = new Simulation(42);
    sim.env = { ...sim.env, seaTemperature: 32, humidity: 98, shear: 0, ridgePressure: 1010, genesisMultiplier: multiplier };
    const cloud = sim.add('cloud', 145, 15, { convection: 2, fieldHumidity: 98, fieldVorticity: 2e-5, fieldConvergence: 5e-6, genesisThreshold: 48 });
    for (let i = 0; i < 200; i++) { cloud.lon = 145; cloud.lat = 15; sim.advance(1); if (cloud.kind !== 'cloud') return sim.hours; }
    return Infinity;
  });
  assert.ok(results[2] >= 24 && results[2] < results[1] && results[1] < results[0]);
  const sim = new Simulation(42); const thresholds = [];
  for (let i = 0; i < 500; i++) { thresholds.push(sim.add('cloud', 145, 15).genesisThreshold); sim.systems.length = 0; }
  assert.ok(thresholds.some(t => t < 10), 'low multiplier is not an absolute prohibition');
});

test('latent candidates consolidate but explicit manual clouds are preserved', () => {
  const sim = new Simulation(42);
  sim.add('cloud', 140, 15, { injected: false }); sim.add('cloud', 140.2, 15, { injected: false });
  const manual = sim.add('cloud', 140.1, 15);
  sim.consolidateCandidates(); assert.equal(sim.systems.length, 2); assert.ok(sim.systems.includes(manual));
});

test('landfall requires sustained land crossing and debounces a dense island chain', () => {
  const sim = new Simulation(42), s = sim.add('disturbance', 140, 15);
  const move = (land, hours, degrees) => { sim.hours += hours; s.lon += degrees; sim.detectLandfall(s, land, hours); };
  move(false, .1, 0); move(true, .1, .01); move(false, .1, .01);
  assert.equal(sim.landfalls.length, 0, 'coast graze is not a confirmed hit');
  move(true, .3, .03); move(true, .3, .2); assert.equal(sim.landfalls.length, 1);
  move(false, .2, .03); move(true, .6, .2); assert.equal(sim.landfalls.length, 1);
  move(false, 3.1, .5); move(true, .6, .2); assert.equal(sim.landfalls.length, 2);
});

test('island footprint retains ocean supply; brown ocean only benefits wet warm land', () => {
  const run = (isLand, landEnergy) => {
    const sim = new Simulation(42, isLand);
    sim.env = { ...sim.env, seaTemperature: 32, humidity: 98, shear: 1, ridgePressure: 1010 };
    const s = sim.add('disturbance', 145, 15, { wind: 40, organization: .9, convection: 2, landEnergy });
    for (let i = 0; i < 24; i++) { s.lon = 145; s.lat = 15; sim.advance(.5); }
    return s;
  };
  const dry = run(() => true, 0), wet = run(() => true, 1), island = run((lon) => Math.abs(lon - 145) < .08, 0);
  assert.ok(wet.wind > dry.wind); assert.ok(island.wind > dry.wind); assert.ok(island.landFraction < .8);
});

test('regridding preserves old/new cloud histories and soil state instead of reseeding', () => {
  const env = environment(42), source = new MoistAtmosphere(42, 64, 48);
  source.advance(1, env, []); source.water.fill(2); source.next[1].fill(.5); source.soilWater.fill(.8);
  const patch = new MoistAtmosphere(42, 32, 24, null, { west: 110, east: 160, north: 40, south: 0 });
  patch.refreshEnvironment(env, 1); new CloudDetails(source).seed(patch, source);
  assert.ok(patch.water.every(v => v === 2)); assert.ok(patch.displayPrevious.every(v => v === .5));
  assert.ok(patch.soilWater.every(v => Math.abs(v - .8) < 1e-6));
});

test('anticyclone reverses rotation and supplies subsidence, not an eyewall', () => {
  const sim = new Simulation(42), anti = sim.add('anticyclone', 145, 20);
  const f = new MoistAtmosphere(42, 96, 96, null, { west: 135, east: 155, north: 30, south: 10 });
  f.advance(0, sim.env, []); f.flow([anti]);
  const p = f.point(147, 20), i = Math.round(p.y) * f.width + Math.round(p.x);
  assert.ok(f.v[i] < f.envFields.v[i]); assert.ok(f.sink[i] > 0); assert.equal(f.lift[i], 0);
  assert.equal(systemName(anti), '反气旋'); assert.equal(systemName(sim.add('extratropical', 150, 40)), '温带气旋');
  sim.advance(12); assert.ok(sim.systems.every(s => Number.isFinite(s.wind) && s.eye === 0));
});
