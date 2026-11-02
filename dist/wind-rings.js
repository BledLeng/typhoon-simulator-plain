import { destination, windRadii } from './simulation.js?v=eye-42';
import { terrainCirculationRadius } from './terrain-interaction.js';

// The model's outer circulation scale is NOT a fixed wind-speed threshold.
// Keep its outline outside the diagnosed 7-force envelope, including large
// storms whose wind envelope extends beyond their nominal circulation scale.
export function circulationRadius(storm, radii = windRadii(storm)) {
  return Math.max(storm.radius || 0, ...radii[0].map(radius => radius * 1.12));
}

const cache = new WeakMap();
export function stormRingGeometry(storm) {
  const radii = windRadii(storm), outer = circulationRadius(storm, radii);
  const key = [storm.lon, storm.lat, outer, storm.terrainRevision, ...radii.flat()].join(':');
  const old = cache.get(storm);
  if (old?.key === key) return old.rings;
  const rings = [{color:'#5481a3', dashed:true, points:Array.from({length:61},(_,i) =>
    destination(storm.lon,storm.lat,i*6,terrainCirculationRadius(storm,i*Math.PI/30,outer)))}];
  for (const [level,color] of ['#f4cc58','#f69a50','#ed6262'].entries()) {
    if (!radii[level].some(radius => radius > 0)) continue;
    const points=[];
    for (let q=0;q<4;q++) for(let angle=0;angle<=90;angle+=3)
      points.push(destination(storm.lon,storm.lat,q*90+angle,
        Math.min(radii[level][q], terrainCirculationRadius(storm,(q*90+angle)*Math.PI/180,outer)/1.12)));
    rings.push({color,dashed:false,points});
  }
  cache.set(storm,{key,rings});
  return rings;
}
