import test from 'node:test';
import assert from 'node:assert/strict';
import {solarPosition,daylight,horizonArcs} from '../dist/day-night.js';
import {MoistAtmosphere} from '../dist/cloud-field.js';
import {environment} from '../dist/simulation.js';
import {CpuWorldObserver} from '../dist/world-cloud-reference.js';

const rad=Math.PI/180;
const mu=(lat,lon,sun)=>Math.sin(lat*rad)*sun.sinDecl+Math.cos(lat*rad)*sun.cosDecl*Math.cos(lon*rad-sun.lon);
test('simulated UTC: noon, midnight, wrapping and polar seasons',()=>{
  const noon=solarPosition(12,80),midnight=solarPosition(0,80);
  assert.ok(mu(0,0,noon)>.99 && mu(0,0,midnight)<-.99);
  assert.ok(Math.abs(mu(65,-180,noon)-mu(65,180,noon))<1e-12);
  assert.ok(Math.abs(noon.decl)<rad && Math.abs(noon.lon)<3*rad);
  assert.ok(mu(80,0,solarPosition(0,172))>0 && mu(80,0,solarPosition(12,355))<0);
  assert.ok(mu(-80,0,solarPosition(0,355))>0);
  assert.ok(Math.abs(mu(20,30,noon)-mu(20,30,solarPosition(12+365*24,80)))<1e-12);
  assert.equal(daylight(0),.5);assert.equal(daylight(-.2),0);assert.equal(daylight(.2),1);
});
test('both terminator branches are true geometric horizons; no date-line/pole chords',()=>{
  for(const decl of [0,-.409,.409,1e-8]){
    const sun={decl,sinDecl:Math.sin(decl),cosDecl:Math.cos(decl),lon:3.13};
    for(const arc of horizonArcs(decl)){
      for(const [i,[x,y]] of arc.entries()){
        const lat=Math.asin(-Math.tanh(y))/rad;
        assert.ok(Math.abs(lat)<85.0001);assert.ok(Math.abs(mu(lat,(x+sun.lon)/rad,sun))<1e-12);
        if(i)assert.ok(Math.abs(x-arc[i-1][0])<.2);
      }
    }
  }
});
test('same water gives unchanged daylight, a contrasting night map and brighter cold cloud; switching is read-only',()=>{
  const f=new MoistAtmosphere(58,180,64),env=environment(58);env.seasonDay=80;
  f.advance(0,env,[]);f.land.fill(0);f.time=12;
  f.water.fill(0);f.convection.fill(0);f.temperature.fill(27);f.envFields.sst.fill(29);
  const i=(x)=>4*(32*f.width+x);
  let pixels=f.pixels('day-night');assert.equal(pixels[i(90)+3],0);
  assert.ok(pixels[i(2)+3]>200&&pixels[i(2)]<20);
  f.water.fill(4);f.convection.fill(.01);f.lightTime=-1;
  pixels=f.pixels('day-night');const cloud=f.pixels();
  assert.deepEqual(pixels.slice(i(90),i(90)+4),cloud.slice(i(90),i(90)+4));
  const warm=pixels[i(2)];f.convection.fill(1);
  assert.ok(f.pixels('day-night')[i(2)]>warm+45);
  const state=f.water.slice(),before=f.pixels('ir-bw');
  f.time=24;assert.notDeepEqual(f.pixels('day-night'),pixels);
  assert.deepEqual(f.water,state);assert.deepEqual(f.pixels('ir-bw'),before);
  const obs=new CpuWorldObserver(f,2);obs.update(f,[],new Map());
  assert.equal(obs.pixels('day-night').length,obs.width*obs.height*4);
  assert.equal(obs.view.seasonDay,80);assert.equal(f.time,24);
});
