import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudSolutionKey,cloudDispatchInterval,SimulationClock} from '../dist/cloud-clock.js';
import {MoistAtmosphere} from '../dist/cloud-field.js';
import {environment} from '../dist/simulation.js';
import {CloudRenderer} from '../dist/cloud-renderer.js';
import {CloudPresentation} from '../dist/cloud-presentation.js';

test('24 Hz presentation does not regenerate identical numerical cloud frames',()=>{
  const sim={hours:0,systems:[{id:1}],env:{revision:0}};
  const keys=new Set();
  for(let frame=0;frame<240;frame++){sim.hours=frame/24;keys.add(cloudSolutionKey(sim,'cloud'));}
  assert.equal(keys.size,20);
  const old=cloudSolutionKey(sim,'cloud');
  sim.systems=[{id:2}];assert.notEqual(cloudSolutionKey(sim,'cloud'),old,'same-count replacement still publishes');
  assert.notEqual(cloudSolutionKey(sim,'sst'),cloudSolutionKey(sim,'cloud'));
  const changed=cloudSolutionKey(sim,'cloud');sim.env.revision++;
  assert.notEqual(cloudSolutionKey(sim,'cloud'),changed);
});
test('deferred previous-state lighting produces the same blended pixels',()=>{
  const f=new MoistAtmosphere(42,64,48);f.advance(1,environment(42),[]);
  const expected=f.pixels('cloud',.5);
  f.lightTime=-Infinity;f.pixels('cloud',1);
  assert.equal(f.previousLightDirty,true);
  assert.deepEqual(f.pixels('cloud',.5),expected);
});
test('renderer sends a new solution on time ticks and cheap probe-only messages while paused',()=>{
  const sent=[],sim={hours:0,systems:[{id:1}],env:{revision:0},ocean:{snapshot:()=>({cells:[]})}};
  const r={simulation:sim,layer:'cloud',presentation:{paint:()=>false},pending:false,lastRequest:-Infinity,
    worker:{postMessage:d=>sent.push(d)},invalidate(){this.invalidated=true;}};
  CloudRenderer.prototype.update.call(r,0);r.pending=false;
  sim.hours=.25;CloudRenderer.prototype.update.call(r,250);assert.equal(sent.length,1);
  sim.hours=.5;CloudRenderer.prototype.update.call(r,500);r.pending=false;assert.equal(sent.length,2);
  r.probe={lon:140,lat:20};CloudRenderer.prototype.update.call(r,650);
  assert.deepEqual(sent[2],{type:'inspect',probe:r.probe});
  CloudRenderer.prototype.accept.call(r,{inspectionOnly:true,inspection:{temperature:27}});
  assert.equal(r.pending,false);assert.equal(r.inspection.temperature,27);assert.equal(r.invalidated,true);
  CloudRenderer.prototype.update.call(r,750);assert.equal(sent.length,3);
  sim.hours=1;CloudRenderer.prototype.update.call(r,1000);assert.equal(sent.length,4);
});
test('requested speed schedules numerical ticks independently of 24Hz presentation',()=>{
  assert.equal(cloudDispatchInterval(0,1),500);
  assert.equal(cloudDispatchInterval(0,24),1000/48);
  for(const workMs of [40,100,300])assert.equal(cloudDispatchInterval(workMs,24),workMs*1.08);
  assert.ok(cloudDispatchInterval(100,24)<cloudDispatchInterval(100,1));
});

test('clock retains blocked time, bounds catch-up and clears it on pause',()=>{
  const clock=new SimulationClock();
  assert.equal(clock.advance(.1,24,true,0,0),.5);
  assert.equal(clock.advance(.1,24,true,.5,0),0);
  assert.equal(clock.debt,1);
  assert.equal(clock.advance(.001,24,true,.5,.5),.5);
  clock.advance(0,24,false,1,1);assert.equal(clock.debt,0);
  assert.equal(clock.advance(.001,1,true,1,1),.001);
});

test('a fast enough worker can advance 24 simulated hours per real second without coarsening steps',()=>{
  for(const rate of [1,3,6,12,24]) {
    const clock=new SimulationClock();let hours=0,completed=0;
    for(let i=0;i<1200;i++) {
      const step=clock.advance(1/120,rate,true,hours,completed);
      assert.ok(step<=.5+1e-9);hours+=step;
      completed=Math.floor((hours+1e-8)/.5)*.5;
    }
    assert.ok(Math.abs(hours-rate*10)<1e-6,`${rate}h/s advanced ${hours}h`);
  }
});
test('24 Hz presentation keeps fractional frame time on 60/120 Hz displays',()=>{
  for(const hz of [60,120]){
    let count=0;
    const p={current:{image:{},patches:[]},previous:{image:{},patches:[]},output:{},patchOutputs:new Map(),
      duration:1000,started:0,lastPaint:-Infinity,active:true,serial:0,mix:()=>count++};
    for(let frame=0;frame<=hz;frame++)if(CloudPresentation.prototype.paint.call(p,frame*1000/hz))count++;
    assert.ok(count>=24 && count<=25,`${hz}Hz display: ${count} cloud frames`);
  }
});
