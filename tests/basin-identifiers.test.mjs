import test from 'node:test';
import assert from 'node:assert/strict';
import {StormIdentifiers,basinLetter,trackLabel} from '../dist/storm-identifiers.js';
import {Simulation} from '../dist/simulation.js';

test('basin, invest and official counters are independent of invisible internal IDs',()=>{
  const sim=new Simulation(426);
  const low=(lon)=>sim.add('disturbance',lon,18,{wind:8});
  const w=Array.from({length:10},()=>low(145)), c=[low(-158),low(-159),low(-160)];
  assert.equal(w.at(-1).trackCode,'99W');assert.equal(c.at(-1).trackCode,'92C');
  const extra=low(144); assert.equal(trackLabel(extra),'未编号');
  for(const s of [w[9],c[0],c[2]]){s.wind=20;sim.trackExtrema(s);}
  assert.deepEqual([w[9],c[0],c[2]].map(s=>s.trackCode),['01W','01C','02C']);
  assert.equal(w[9].lastInvestCode,'99W');
  sim.trackExtrema(extra);assert.equal(extra.trackCode,'99W');
  c[2].lon=155;c[2].wind=8;sim.trackExtrema(c[2]);assert.equal(c[2].trackCode,'02C');
  sim.finishSystem(c[2],'消散');assert.equal(sim.rankings[0].trackCode,'02C');
  for(const kind of ['cloud','anticyclone','extratropical'])assert.equal(sim.add(kind,140,43).trackCode,undefined);
});
test('all suffixes, invest relocation, AL/EP crossover and season reset',()=>{
  for(const [x,y,letter] of [[150,18,'W'],[-158,16,'C'],[-108,14,'E'],[-56,18,'L'],[63,13,'A'],
    [89,16,'B'],[60,-14,'S'],[150,-16,'P'],[-37,-18,'Q'],[17,36,'M']])assert.equal(basinLetter(x,y),letter);
  const ids=new StormIdentifiers(1), s={lon:-105,lat:15,wind:8,kind:'disturbance'};
  ids.update(s,[s],0);assert.equal(s.trackCode,'90E');
  s.lon=-70;ids.update(s,[s],2);assert.equal(s.trackCode,'90L');
  s.wind=22;ids.update(s,[s],3);assert.equal(s.trackCode,'01L');
  s.lon=-105;ids.update(s,[s],8);assert.equal(s.trackCode,'01E');
  const next={lon:-105,lat:15,kind:'disturbance',wind:22};
  ids.update(next,[next],365*24);assert.equal(next.trackCode,'01E');
});
