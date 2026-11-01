import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawWrappedContour } from '../dist/wind-contour.js';
import { project } from '../dist/map-math.js';
import { destination } from '../dist/simulation.js';

function trace(lon,lat,radius,camera=0) {
  const scale=140,width=900, paths=[]; let path, filled=0;
  const ctx={beginPath(){paths.push(path=[])},moveTo(x,y){path.push([x,y])},lineTo(x,y){path.push([x,y])},closePath(){},fill(){filled++},stroke(){}};
  const screen=(lon,lat,wrap=true)=>{
    const p=project(lon,lat); if(wrap)p.x+=Math.round((camera-p.x)/(Math.PI*2))*Math.PI*2;
    return{x:width/2+(p.x-camera)*scale,y:400+p.y*scale};
  };
  const center={lon,lat}, points=Array.from({length:61},(_,i)=>destination(lon,lat,i*6,radius));
  drawWrappedContour(ctx,center,points,screen,scale,width);
  return{paths,filled};
}
test('high latitude rings never connect date-line vertices across the viewport',()=>{
  for(const camera of [0,Math.PI,Math.PI*2])for(const lon of [-179,179,540]) {
    const {paths,filled}=trace(lon,60,1100,camera);
    assert.ok(paths.length && filled);
    for(const path of paths)for(let i=1;i<path.length;i++)assert.ok(Math.abs(path[i][0]-path[i-1][0])<150);
  }
});
test('pole-enclosing contours cannot close into a filled green rectangle',()=>{
  for(const lat of [82,-82]) {
    const {paths,filled}=trace(170,lat,1400);
    assert.ok(paths.length);assert.equal(filled,0);
    for(const path of paths)for(let i=1;i<path.length;i++)assert.ok(Math.abs(path[i][0]-path[i-1][0])<150);
  }
});
