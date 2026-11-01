import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadCloudKernel} from '../dist/cloud-kernel.js';
import {MoistAtmosphere} from '../dist/cloud-field.js';
import {environment} from '../dist/simulation.js';
import {CloudDetails} from '../dist/cloud-detail.js';

await loadCloudKernel(await readFile(new URL('../dist/cloud-kernel.wasm',import.meta.url)));
for(const periodic of [true,false])test(`compiled moist physics matches JS, periodic=${periodic}`,()=>{
  const bounds=periodic?undefined:{west:137,east:143,north:21,south:15};
  const land=Uint8Array.from({length:80*64},(_,i)=>i%3===0?1:0);
  const a=new MoistAtmosphere(42,80,64,land,bounds),b=new MoistAtmosphere(42,80,64,land,bounds);
  assert.ok(a.kernel);b.kernel=null;
  const env=environment(42),systems=[{id:1,kind:'disturbance',lon:140,lat:18,wind:45,
    radius:350,organization:.8,eye:.3,dryIntrusion:.2,dryAirHumidity:50,dryAirAngle:.8}];
  a.advance(0,env,systems);b.advance(0,env,systems);
  a.seaCooling.fill(1);b.seaCooling.fill(1);
  for(let n=0;n<16;n++){a.advance(.5,env,systems);b.advance(.5,env,systems);}
  for(const key of ['water','vapor','temperature','cold','convection','soilWater','soilHeat']) {
    let error=0;for(let i=0;i<a.n;i++)error=Math.max(error,Math.abs(a[key][i]-b[key][i]));
    assert.ok(error<2e-5,`${key}: ${error}`);
  }
});

test('compiled state remains finite through fine-mesh movement, regridding and retirement',()=>{
  const env=environment(42),field=new MoistAtmosphere(42,64,48),details=new CloudDetails(field);
  const storm={id:1,kind:'disturbance',lon:140,lat:18,wind:40,radius:300,organization:.7,eye:.2,u:20,v:0};
  field.advance(0,env,[storm]);details.update([storm],env);
  for(let n=0;n<12;n++) {
    storm.lon+=.12;field.advance(.5,env,[storm]);details.update([storm],env);
    for(const mesh of [field,...details.patches.values()]) {
      assert.ok(mesh.kernel);
      for(const key of ['water','vapor','temperature','convection'])assert.ok(mesh[key].every(Number.isFinite),key);
    }
  }
  assert.ok(details.patches.get(1).meshMoves>0);
  field.advance(1,env,[]);details.update([],env);
  assert.ok(details.patches.get(1).water.some(v=>v>0),'retiring clouds remain physical state');
});
