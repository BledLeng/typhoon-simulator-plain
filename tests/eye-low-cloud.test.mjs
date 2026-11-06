import test from 'node:test';
import assert from 'node:assert/strict';
import {MoistAtmosphere} from '../dist/cloud-field.js';
import {CloudDetails} from '../dist/cloud-detail.js';
import {environment} from '../dist/simulation.js';
import {advanceEyeLowCloud} from '../dist/eye-low-cloud.js';
import {visiblePixels} from '../dist/cloud-shadow.js';
import {cloudProductPixels,dayNightPixels} from '../dist/cloud-products.js';

function fixture(rh=92){
 const f=new MoistAtmosphere(117,64,64,null,{west:138,east:142,north:20,south:16});
 const e={...environment(117),humidity:rh};f.advance(0,e,[]);
 f.envFields.sst.fill(30);f.envFields.humidity.fill(rh);f.land.fill(0);f.seaCooling.fill(0);
 f.u.fill(5);f.v.fill(0);f.water.fill(0);f.convection.fill(0);
 return f;
}
const storm={id:1,kind:'disturbance',lon:140,lat:18,wind:70,organization:.95,warmCore:.95,coreRadius:170,radius:500,eye:.9};
const sum=v=>v.reduce((a,b)=>a+b,0);
function run(f,s=[storm],hours=12){for(let t=0;t<hours;t+=.25){f.time+=.25;advanceEyeLowCloud(f,s,.25);}return f;}

test('moist eyes develop patchy thin low clouds without adding deep convection or erasing the warm core',()=>{
 const f=fixture(),deep=f.water.slice();run(f);
 const occupied=f.eyeWater.filter(v=>v>.005).length;
 assert.ok(occupied>10&&occupied<f.n*.4,'not a uniformly filled eye: '+occupied);
 assert.ok(f.eyeWater.every(v=>Number.isFinite(v)&&v>=0&&v<=.24));
 assert.deepEqual(f.water,deep);assert.ok(f.convection.every(v=>v===0));
 assert.ok(f.eyeVapor.every(v=>Number.isFinite(v)&&v>=0));
});
test('dry, land and unopened eyes do not receive a mandatory decorative veil',()=>{
 const dry=run(fixture(25)),land=fixture(),closed=fixture();land.land.fill(1);run(land);
 run(closed,[{...storm,eye:0}]);
 for(const f of [dry,land,closed])assert.equal(sum(f.eyeWater),0);
});
test('pause and product changes do not evolve low clouds; loss of forcing decays existing cloud',()=>{
 const f=run(fixture()),before=f.eyeWater.slice(),water=f.water.slice();
 advanceEyeLowCloud(f,[storm],0);
 for(const layer of ['ir-rbtop','ir-ott','convection'])cloudProductPixels(f,layer);
 dayNightPixels(f,visiblePixels(f,true,{}));
 assert.deepEqual(f.eyeWater,before);assert.deepEqual(f.water,water);
 run(f,[],1);assert.ok(sum(f.eyeWater)<sum(before));
});
test('low clouds are visible but warm in IR and cannot paint deep convection',()=>{
 const f=fixture(),bare=cloudProductPixels(f,'ir-bw'),conv=cloudProductPixels(f,'convection');
 f.eyeWater=new Float32Array(f.n).fill(.12);
 const visible=visiblePixels(f,false,{}),ir=cloudProductPixels(f,'ir-bw');
 assert.ok(visible[3]>60&&visible[3]<150);
 assert.ok(ir[0]>=bare[0]&&ir[0]<bare[0]+8,'low-cloud Tb remains near the sea surface');
 assert.deepEqual(cloudProductPixels(f,'convection'),conv);
 f.water.fill(8);f.convection.fill(1);
 const covered=cloudProductPixels(f,'ir-bw');f.eyeWater.fill(0);
 assert.deepEqual(cloudProductPixels(f,'ir-bw'),covered,'opaque high cloud hides low cloud radiometrically');
});
test('nest regridding carries the shallow layer rather than stamping it anew',()=>{
 const parent=new MoistAtmosphere(117,64,48),env=environment(117),details=new CloudDetails(parent);
 parent.advance(0,env,[storm]);details.update([storm],env);
 const p=details.patches.get(1);p.eyeWater.fill(.07);p.eyeVapor.fill(18);
 const shifted={...storm,lon:storm.lon+1};details.movePatch(p,shifted,env);
 const center=Math.floor(p.height/2)*p.width+Math.floor(p.width/2);
 assert.ok(Math.abs(p.eyeWater[center]-.07)<1e-6);assert.equal(p.eyeVapor[center],18);
 assert.ok(p.eyeWater.every(Number.isFinite));
});
