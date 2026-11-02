import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation, evolveEyewalls, radiusOfMaximumWind} from '../dist/simulation.js';
import {bandAnomaly, eyeStructure, eyeStructureDetails} from '../dist/eye-morphology.js';
import {MoistAtmosphere} from '../dist/cloud-field.js';

const moist = {support:.82, convection:.9, humidity:85, shear:5};
const mature = {wind:62, eye:.8, organization:.9, warmCore:.8, coreSymmetry:.9, radius:290, coreRadius:38};
function storm(options={}) {
  const sim = new Simulation(117);
  return sim.add('disturbance',140,18,{...mature, ...options});
}
function advance(s, hours, e=moist, dt=.25) {
  for(let t=0;t<hours;t+=dt)evolveEyewalls(s,e,dt);
}

test('curved-band organisation takes time, is not a clear-eye threshold and responds to ventilation',()=>{
  const s=storm({wind:44,eye:.10,coreSymmetry:.50}), dry=structuredClone(s);
  advance(s,1);assert.ok(s.eyeBand>0 && eyeStructure(s)===null);
  advance(s,11);assert.equal(eyeStructure(s),'banding');assert.equal(s.eye,.10);
  advance(dry,24,{...moist,shear:26});assert.ok(!(dry.eyeBand>0));
  advance(s,20,{...moist,humidity:42});assert.equal(eyeStructure(s),null);
  const symmetric=storm({wind:44,eye:.10,coreSymmetry:.95});
  advance(symmetric,36,{...moist,shear:2});assert.equal(eyeStructure(symmetric),null);
  for(const kind of ['anticyclone','cloud','extratropical','subtropical']) {
    const other=storm({kind,eye:.1});advance(other,12);assert.ok(!(other.eyeBand>0));
  }
});

test('inner rainband is continuous, reverses winding by hemisphere and affects only the core',()=>{
  const get=(r,az,spin)=>bandAnomaly(r,Math.cos(az),Math.sin(az),0,spin,.8);
  for(const r of [.6,1,1.3,1.8,2.3]) {
    const a=-4.4*Math.log(r);
    assert.ok(get(r,a,1)>0);
    assert.ok(Math.abs(get(r,a,1)-get(r,-a,-1))<1e-12);
    assert.ok(Math.abs(get(r,a,1)+get(r,a+Math.PI,1))<1e-12);
  }
  assert.equal(get(.2,0,1),0);assert.equal(get(4,0,1),0);
});

test('a band modifies resolved moist ascent and condensate, not just the displayed label',()=>{
  const s=storm({eye:.2,eyeBand:.88,rotation:0}), f=new MoistAtmosphere(117,96,96,null,{west:138,east:142,north:20,south:16});
  const env=new Simulation(117).env;f.advance(0,env,[]);
  f.vapor.set(f.temperature.map(t=>3.8*Math.exp(.059*t)));
  const quiet={...s,eyeBand:0};f.flow([quiet]);const reference=f.lift.slice();f.flow([s]);
  let higher=0, lower=0;
  for(let i=0;i<f.n;i++){const d=f.lift[i]-reference[i];if(d>.005)higher++;if(d<-.005)lower++}
  assert.ok(higher>4 && lower>4,'ascent concentrates in some sectors not an entire ring');
  const control=new MoistAtmosphere(117,96,96,null,{west:138,east:142,north:20,south:16});
  control.advance(0,env,[]);control.vapor.set(f.vapor);
  for(let i=0;i<8;i++){f.advance(.125,env,[s]);control.advance(.125,env,[quiet])}
  assert.ok(f.water.some((v,i)=>Math.abs(v-control.water[i])>.01));
});

test('two retained walls converge gradually into one; a failing inner wall instead undergoes classic replacement',()=>{
  const fused=storm(), classic=storm({coreSymmetry:.27});
  let touched=false, minInner=1, ended=false;
  for(let i=0;i<24*4*5;i++){
    evolveEyewalls(fused,moist,.25);evolveEyewalls(classic,moist,.25);
    const c=fused.eyewallCycle;
    if(c.phase==='merging'){
      assert.equal(eyeStructure(fused),'fusion');
      assert.ok(c.radius>=fused.coreRadius && c.strength>0);
      if(!touched){assert.ok(c.radius-fused.coreRadius>.1*fused.coreRadius);touched=true;}
      minInner=Math.min(minInner,c.inner);
    } else if(touched && fused.eyewallMergers){ended=true}
  }
  assert.ok(touched && ended && minInner>.48);
  assert.equal(fused.eyewallMergers,1);assert.ok(!fused.eyewallReplacements);
  assert.equal(classic.eyewallReplacements,1);assert.ok(!classic.eyewallMergers);
  assert.match(eyeStructureDetails(fused,'en'),/mergers: 1/);
  assert.match(eyeStructureDetails(fused),/眼墙融合：1/);
});

test('loss of support during contact aborts the merger and does not increment either counter',()=>{
  const s=storm();
  for(let i=0;i<600 && s.eyewallCycle?.phase!=='merging';i++)evolveEyewalls(s,moist,.25);
  assert.equal(s.eyewallCycle.phase,'merging');
  advance(s,50,{...moist,shear:27});
  assert.equal(s.eyewallCycle.phase,'none');assert.equal(s.eyewallCycle.strength,0);
  assert.ok(!s.eyewallMergers && !s.eyewallReplacements && radiusOfMaximumWind(s)>0);
});
