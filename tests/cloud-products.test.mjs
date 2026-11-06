import test from 'node:test';
import assert from 'node:assert/strict';
import { MoistAtmosphere } from '../dist/cloud-field.js';
import { CloudDetails } from '../dist/cloud-detail.js';
import { Simulation, environment } from '../dist/simulation.js';
import { brightnessTemperature, cloudDiagnostic, isCloudProduct } from '../dist/cloud-products.js';
import {scaleColor, scaleRGBA} from '../dist/satellite-scales.js';

test('satellite enhancements distinguish radiometric ranges, not storm grades',()=>{
  assert.deepEqual(scaleColor('ir-bd',-66),[0,0,0]);
  assert.deepEqual(scaleColor('ir-bd',-72),[255,255,255]);
  assert.ok(scaleColor('ir-bw',-72)[0]>scaleColor('ir-bw',-20)[0]);
  assert.deepEqual(scaleColor('ir-rbtop',-56),[255,255,0]);
  const f=new MoistAtmosphere(42,16,16);f.advance(0,environment(42),[]);
  f.water.fill(0);f.land.fill(0);f.envFields.sst.fill(25);f.seaCooling.fill(0);
  for(const layer of ['ir-bw','ir-bd','ir-rbtop']) {
    const rgb=f.pixels(layer).slice(0,3), legend=scaleColor(layer,25);
    assert.ok(rgb.every((v,i)=>Math.abs(v-legend[i])<=1));
  }
  f.water.fill(2);f.convection.fill(0);
  const [r,g,b]=f.pixels('convection');assert.equal(r,g);assert.equal(g,b);
  f.convection.fill(.4);const active=f.pixels('convection');assert.ok(active[0]>active[2]+60);
});

test('OTT maps the existing IR temperature to Dapiya colour anchors and preserves the three jumps',()=>{
  assert.ok(isCloudProduct('ir-ott'));
  for(const [t,c] of [[30,[0,0,0]],[-20,[0,255,255]],[-30,[0,0,115]],[-50,[255,255,0]],
    [-60,[255,0,0]],[-70,[0,0,0]],[-80,[230,100,188]],[-90,[255,255,255]]])
    assert.deepEqual(scaleRGBA('ir-ott',t),[...c,255]);
  assert.deepEqual(scaleColor('ir-ott',-19.99),[200,200,200]);
  assert.deepEqual(scaleColor('ir-ott',-79.99),[230,230,230]);
  assert.deepEqual(scaleColor('ir-ott',-89.99),[128,0,128]);
});

test('IR mixes radiance, not temperature; thin cloud retains warm-surface contribution', () => {
  assert.ok(Math.abs(brightnessTemperature(28, -70, 0) - 28) < 1e-10);
  assert.ok(Math.abs(brightnessTemperature(28, -70, 1) + 70) < 1e-10);
  const thin = brightnessTemperature(28, -70, .2), thick = brightnessTemperature(28, -70, .9);
  assert.ok(thin > thick && thin < 28 && thick > -70);
  assert.ok(thin > 28 * .8 - 70 * .2, 'radiance mixture differs from linear temperature');
});

test('cold-cloud overlay fades through green to transparent; cold tops deepen to red', () => {
  const [r,g,b,a]=scaleRGBA('infrared',-13);
  assert.ok(g>r && g>b && a>0 && a<150);
  const pale=scaleRGBA('infrared',-33);
  assert.ok(pale[0]>200 && pale[1]>220 && pale[2]>165 && pale[3]>a);
  for(const t of [8,20,40])assert.equal(scaleRGBA('infrared',t)[3],0);
  for(let t=-89;t<=8;t++)assert.ok(scaleRGBA('infrared',t)[3]<=scaleRGBA('infrared',t-1)[3]);
  for(const t of [-53,-63,-73,-83]){
    const [red,green,blue,alpha]=scaleRGBA('infrared',t);
    assert.ok(red>green && red>blue && alpha>240);
    assert.ok(red<scaleRGBA('infrared',t+5)[0]);
  }
});

test('cold-cloud opacity is applied to actual brightness and emissivity, not bare cold land', () => {
  const field = new MoistAtmosphere(42, 16, 16);
  field.advance(0, environment(42), []); field.water.fill(8);
  field.temperature.fill(28);
  const i=8*16,trop=17-6*Math.abs(Math.sin(field.lat[8]*Math.PI/180));
  for (const activity of [0,.04,.1,.22,.5,1]) {
    field.convection.fill(activity);
    const d=cloudDiagnostic(field,i,trop);
    const expected=scaleRGBA('infrared',brightnessTemperature(d.surface,d.top,d.emissivity));
    expected[3]=Math.round(expected[3]*d.emissivity);
    assert.ok(field.pixels('infrared').slice(4*i,4*i+4).every((v,k)=>Math.abs(v-expected[k])<=1));
  }
  field.water.fill(0);field.land.fill(1);field.soilHeat.fill(-50);
  assert.equal(field.pixels('infrared')[3],0);assert.equal(field.pixels('ir-rbtop')[3],255);
});

test('convection has transported finite memory rather than switching off on a dry substep', () => {
  const field = new MoistAtmosphere(42, 32, 24);
  field.advance(0, environment(42), []);
  field.vapor.fill(0); field.water.fill(0); field.convection.fill(1);
  field.step(.125, []);
  assert.ok(field.convection.every(v => v > .90 && v < .93));
  const before = field.convection.slice();
  field.pixels('infrared'); field.pixels('convection');
  assert.deepEqual(field.convection, before, 'presentation cannot advance diagnostic memory');
});

test('diagnostic layers are finite, distinct and read-only; a strong dry vortex does not paint convection', () => {
  const field = new MoistAtmosphere(42, 48, 32), env = environment(42);
  field.advance(.5, env, []);
  const original = ['water', 'vapor', 'temperature', 'cold', 'convection'].map(k => field[k].slice());
  const cloud = field.pixels(), convection = field.pixels('convection'), infrared = field.pixels('infrared');
  assert.equal(convection.length, field.n * 4);
  assert.equal(infrared.length, field.n * 4);
  assert.notDeepEqual(cloud, convection); assert.notDeepEqual(convection, infrared);
  ['water', 'vapor', 'temperature', 'cold', 'convection'].forEach((k, i) => assert.deepEqual(field[k], original[i]));
  field.water.fill(0); field.convection.fill(0);
  assert.equal(field.pixels('convection').filter((_, i) => i % 4 === 3).some(Boolean), false);
  const dry = cloudDiagnostic(field, 0, 16);
  field.water[0] = 1; field.convection[0] = .4;
  const active = cloudDiagnostic(field, 0, 16);
  assert.equal(dry.activity, 0); assert.ok(active.activity > .8);
  assert.ok(active.top < dry.top && active.emissivity > dry.emissivity);
});

test('both cloud products resolve the existing fine meshes without a second solver', () => {
  const sim = new Simulation(27), storm = sim.add('disturbance', 140, 18, {wind:55, radius:300});
  const field = new MoistAtmosphere(27, 64, 48), details = new CloudDetails(field);
  field.advance(.5, sim.env, [storm]); details.update([storm], sim.env);
  field.advance(.5, sim.env, [storm]); details.update([storm], sim.env);
  const time = field.time, patch = [...details.patches.values()][0], water = patch.water.slice();
  for (const layer of ['convection', 'infrared','ir-bw','ir-bd','ir-rbtop']) {
    assert.equal(isCloudProduct(layer), true);
    const images = details.images(1, field.pixels(layer), layer);
    assert.equal(images.length, 1); assert.equal(images[0].width, 160);
    assert.equal(field.time, time); assert.deepEqual(patch.water, water);
  }
  assert.equal(isCloudProduct('sst'), false);
  assert.ok(patch.convection.every(Number.isFinite));
});

test('worker switches cloud products at the same simulation time without advancing physics', async () => {
  const output = []; globalThis.self = {postMessage:data => output.push(data)};
  try {
    await import('../dist/cloud-worker.js?product-test');
    const sim = new Simulation(42), s = sim.add('disturbance',140,18,{wind:55,radius:300});
    self.onmessage({data:{type:'init',seed:42,width:64,height:48,land:new Uint8Array(64*48).buffer}});
    await self.onmessage.idle();
    for (const layer of ['cloud','convection','infrared','ir-bw','ir-bd','ir-rbtop','ir-ott','cloud']) {
      self.onmessage({data:{hours:.5,env:sim.env,systems:[s],layer,ocean:{cells:[]}}});
      await self.onmessage.idle();
      const result = output.at(-1);
      assert.equal(result.error, undefined); assert.equal(result.fieldHours,.5);
      assert.equal(result.observation,'global-cpu');
      assert.deepEqual([result.width,result.height],[128,96]);
      assert.equal(result.patches.length,0); assert.equal(result.layer,layer);
    }
    assert.deepEqual(new Uint8Array(output[0].buffer),new Uint8Array(output.at(-1).buffer));
  } finally {delete globalThis.self;}
});
