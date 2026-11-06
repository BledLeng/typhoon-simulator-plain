import test from 'node:test';
import assert from 'node:assert/strict';
import {visiblePixels} from '../dist/cloud-shadow.js';
import {dayNightPixels} from '../dist/cloud-products.js';

function scene(){
  const width=96,height=32,n=width*height;
  const f={width,height,n,seasonDay:80,time:12,water:new Float32Array(n),convection:new Float32Array(n),
    kmx:new Float32Array(height).fill(2),kmy:new Float32Array(height).fill(2),
    lat:new Float32Array(height),lon:Float32Array.from({length:width},(_,x)=>(x-48)*.018),
    temperature:new Float32Array(n).fill(27),envFields:{sst:new Float32Array(n).fill(28)},
    land:new Uint8Array(n),seaCooling:new Float32Array(n)};
  for(let y=0;y<height;y++)for(let x=43;x<=53;x++){
    const i=y*width+x;f.water[i]=2;f.convection[i]=.65;
  }
  return f;
}
const at=(f,x,y=16)=>4*(y*f.width+x);
function sides(f,p){
  const sum=(l,r)=>{let a=0;for(let x=l;x<r;x++)a+=p[at(f,x)+3];return a;};
  return [sum(23,43),sum(54,74)];
}
test('morning and afternoon project to opposite clear surfaces; high noon is short, unlit night is thermal only',()=>{
  const f=scene(),cache={},water=f.water.slice(),activity=f.convection.slice();
  const capture=t=>{f.time=t;return visiblePixels(f,true,cache);};
  const am=sides(f,capture(8)), noon=sides(f,capture(12)), pm=sides(f,capture(16));
  assert.ok(am[0]>120 && am[1]===0,am);assert.ok(pm[1]>110 && pm[0]===0,pm);
  assert.ok(noon[0]+noon[1] < Math.min(am[0],pm[1])*.20,noon);
  const dark=capture(0);assert.ok(dark.every(x=>x===0));
  const thermal=dayNightPixels(f,dark.slice());
  assert.equal(thermal[at(f,42)+3],thermal[at(f,54)+3]);
  assert.deepEqual(f.water,water);assert.deepEqual(f.convection,activity);
});
test('towers shade low cloud, uniform decks do not shadow themselves, and no water means no shadow',()=>{
  const f=scene(),high=f.water.slice();f.water.fill(.15);f.convection.fill(0);
  const plain=visiblePixels(f,false,{}),k=at(f,55);
  for(let i=0;i<f.n;i++)if(high[i]){f.water[i]=high[i];f.convection[i]=.65;}
  const projected=visiblePixels(f,false,{});
  assert.ok(projected[k]<plain[k]-15,'low cloud on lee side is darker');
  assert.ok(projected[k+3]>plain[k+3]);
  assert.equal(projected[at(f,35)],plain[at(f,35)]);
  f.water.fill(0);assert.ok(visiblePixels(f,false,{}).every(x=>x===0));
});
test('shadow wraps across the date line, no north/south wrapping',()=>{
  const f=scene();f.water.fill(0);f.convection.fill(0);
  for(let y=4;y<25;y++)for(let x=88;x<96;x++){
    const i=y*f.width+x;f.water[i]=2;f.convection[i]=.5;
  }
  const p=visiblePixels(f,false,{});
  assert.ok(p[at(f,0)+3]>30 && p[at(f,1)+3]>15);
  assert.equal(p[at(f,0,0)+3],0);
});
