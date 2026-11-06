import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MoistAtmosphere } from '../dist/cloud-field.js';
import { CloudDetails } from '../dist/cloud-detail.js';
import { environment } from '../dist/simulation.js';

const storm = (id, lon = 140) => ({ id, lon, lat: 18, wind: 40, organization: .8, eye: .2, radius: 350, kind: 'disturbance', injected: false });

test('local grids use geographic bounds and genuinely finer cell spacing', () => {
  const f = new MoistAtmosphere(42, 512, 384), env = environment(42);
  f.advance(0, env, []);
  const details = new CloudDetails(f); details.update([storm(1)], env, null, 1);
  const patch = details.patches.get(1), p = patch.point(140, 18);
  assert.ok(p.x > 0 && p.x < patch.width && p.y > 0 && p.y < patch.height);
  assert.ok(patch.kmx[Math.round(p.y)] < 12);
  assert.ok(patch.kmx[Math.round(p.y)] < f.kmx[Math.round(f.point(140, 18).y)] / 4);
  assert.equal(patch.time, f.time);
});

test('nested clouds evolve numerically, remain finite, and have bounded memory', () => {
  const f = new MoistAtmosphere(42, 96, 64), env = environment(42);
  f.advance(0, env, []);
  const details = new CloudDetails(f), storms = [storm(1), storm(2, 141), storm(3, 165), storm(4, 195), storm(5, 230)];
  details.update(storms, env, null, 1);
  assert.equal(details.patches.size, 3);
  assert.ok(!details.patches.has(2), 'close vortices share a grid instead of duplicated clouds');
  const before = details.patches.get(1).vapor.slice();
  f.advance(.5, env, storms); details.update(storms, env, null, 1);
  assert.notDeepEqual(before, details.patches.get(1).vapor, 'thermodynamic state evolves even when that location starts cloud-free');
  for (const patch of details.patches.values()) for (const name of ['water', 'vapor', 'temperature']) {
    assert.ok(patch[name].every(Number.isFinite));
  }
  const pixels = f.pixels(), images = details.images(.5, pixels);
  assert.equal(images.length, 3); assert.ok(images.every(p => p.buffer.byteLength === p.width * p.height * 4));
  details.update([], env, null, null); assert.equal(details.patches.size, 3, 'removal of markers must retain numerical clouds');
});

test('7 m/s display threshold and removal of a host never erase its clouds', () => {
  const parent = new MoistAtmosphere(42, 96, 64), env = environment(42), details = new CloudDetails(parent);
  const cyclone = storm(1); parent.advance(0, env, [cyclone]); details.update([cyclone], env);
  const patch = details.patches.get(1); patch.water.fill(2); patch.displayPrevious.fill(2);
  const water = patch.water.slice(); cyclone.wind = 6.9;
  details.update([cyclone], env);
  assert.equal(details.patches.get(1), patch); assert.deepEqual(patch.water, water);
  details.update([], env);
  assert.equal(details.patches.get(1), patch); assert.deepEqual(patch.water, water);
  parent.advance(.5, env, []); details.update([], env);
  assert.notDeepEqual(patch.water, water, 'remnant continues the same moist solver with no tracked vortex');
  assert.ok(parent.water.some(v => v > 0), 'moist state remains in the background atmosphere');
});

test('temporal cloud interpolation is bounded by its two numerical states', () => {
  const f = new MoistAtmosphere(42, 32, 24); f.advance(0, environment(42), []); f.advance(.5, environment(42), []);
  const a = f.pixels('cloud', 0), b = f.pixels('cloud', 1), middle = f.pixels('cloud', .5);
  for (let i = 3; i < a.length; i += 4) assert.ok(middle[i] >= Math.min(a[i], b[i]) && middle[i] <= Math.max(a[i], b[i]));
});

test('zoom, panning and selection never change numerical clouds while paused', () => {
  const f = new MoistAtmosphere(42, 64, 48), env = environment(42), detail = new CloudDetails(f);
  f.advance(0, env, []);
  const storms = [storm(1), storm(2, 170), storm(3, 210), storm(4, 260)];
  detail.update(storms, env, { west: 85, east: 165, north: 85, south: -60 }, 1);
  const patches = [...detail.patches.values()], original = patches.map(p => p.water.slice());
  const images = detail.images(1, f.pixels()).map(p => new Uint8Array(p.buffer).slice());
  for (const view of [{ west: 136, east: 144, north: 22, south: 14 }, { west: 240, east: 300, north: 60, south: 0 }, null]) {
    detail.update(storms, env, view, 4);
    assert.deepEqual([...detail.patches.values()], patches);
    patches.forEach((p, i) => assert.deepEqual(p.water, original[i]));
    detail.images(1, f.pixels()).forEach((p, i) => assert.deepEqual(new Uint8Array(p.buffer), images[i]));
  }
});

test('user-created cloud enters an existing visible mesh even while paused', () => {
  const parent = new MoistAtmosphere(42, 64, 48), env = environment(42), detail = new CloudDetails(parent);
  parent.advance(0, env, []);
  const view = { west: 120, east: 160, north: 40, south: 0 };
  const cyclone = storm(1);
  detail.update([cyclone], env, view, null);
  const patch = detail.patches.get(1), before = patch.water.slice(), cloud = { ...storm(99), kind: 'cloud', injected: true };
  parent.advance(0, env, [cyclone, cloud]); detail.update([cyclone, cloud], env, view, null);
  assert.notDeepEqual(before, patch.water);
  const once = patch.water.slice(); detail.update([cyclone, cloud], env, view, null);
  assert.deepEqual(once, patch.water, 'injection happens once, not every presentation frame');
});

test('camera-independent evolution gives identical results for different view histories', () => {
  const env = environment(42), systems = [storm(1)];
  const a = new MoistAtmosphere(42, 64, 48), b = new MoistAtmosphere(42, 64, 48);
  a.advance(0, env, systems); b.advance(0, env, systems);
  const da = new CloudDetails(a), db = new CloudDetails(b);
  for (let i = 0; i < 5; i++) {
    a.advance(.5, env, systems); b.advance(.5, env, systems);
    da.update(systems, env, null, null);
    db.update(systems, env, { west: 140 - i, east: 142 + i, north: 22, south: 10 }, 1);
  }
  assert.deepEqual(da.patches.get(1).water, db.patches.get(1).water);
});

test('storm detail correction fades before the rectangular mesh boundary', () => {
  const env = environment(42), parent = new MoistAtmosphere(42, 64, 48);
  parent.advance(0, env, []); parent.water.fill(0);
  const details = new CloudDetails(parent); details.update([storm(1)], env);
  const patch = details.patches.get(1); patch.water.fill(3); patch.displayPrevious.fill(3);
  patch.createdAt = -3; // established mesh; arrival is tested separately below
  const pixels = new Uint8Array(details.images(1, parent.pixels())[0].buffer);
  const alpha = (x, y) => pixels[(y * patch.width + x) * 4 + 3];
  const middle = Math.floor(patch.width / 2);
  assert.equal(alpha(0, middle), 0); assert.equal(alpha(middle, 0), 0);
  assert.equal(alpha(10, 10), 0, 'corner detail must not expose a rectangular tile');
  assert.ok(alpha(middle, middle) > alpha(12, middle));
  assert.ok(alpha(12, middle) > 0, 'broad smooth overlap, not a hard circular cut');
});

test('weak new low cannot replace the shared cloud with a fine-grid hole', () => {
  const env = environment(42), parent = new MoistAtmosphere(42, 96, 64);
  parent.advance(0, env, []); parent.water.fill(.8);
  const details = new CloudDetails(parent), low = { ...storm(1), wind: 8, eye: 0, organization: .25 };
  details.update([low], env); parent.flow([low]);
  assert.equal(details.patches.size, 0);
  assert.ok(parent.water.every(v => Math.abs(v - .8) < 1e-6));
  assert.ok(parent.sink.every(v => v === 0));
  low.wind = 18; details.update([low], env);
  const patch = details.patches.get(1); patch.water.fill(0); patch.displayPrevious.fill(0);
  const base = parent.pixels(), image = new Uint8Array(details.images(1, base)[0].buffer);
  assert.ok(image.every((value, i) => i % 4 !== 3 || value === base[3]), 'new nest starts with parent opacity even if fine water differs');
  details.restrictToParent(patch);
  assert.ok(parent.water.every(v => Math.abs(v - .8) < 1e-6), 'no instantaneous fine-grid water replacement');
});
