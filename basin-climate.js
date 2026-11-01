// Offline monthly normals provided by NOAA PSL, Boulder, Colorado, USA.
// Grid: Jan..Dec, latitude -85..85, longitude 0..355, every five degrees.
import {packedNormals} from './monthly-normals.generated.js';
const data = Uint8Array.from(atob(packedNormals), c => c.charCodeAt(0));
const W = 72, H = 35, stride = W * H * 2;
const mid = [15.5,45,74.5,105,135.5,166,196.5,227.5,258,288.5,319,349.5];
let lastDay, m0, m1, t;
export function monthlyClimate(lon, lat, day) {
  if (day !== lastDay) {
    lastDay = day;
    let d = ((day-1)%365 + 365)%365 + 1;
    if (d < mid[0]) d += 365;
    let m = 11;
    while (m > 0 && d < mid[m]) m--;
    m0 = m*stride; m1 = (m+1)%12*stride;
    t = (d-mid[m]) / ((m === 11 ? mid[0]+365 : mid[m+1]) - mid[m]);
  }
  const x = ((lon%360+360)%360)/5, y = Math.max(0,Math.min(H-1,(lat+85)/5));
  const ix = Math.floor(x), iy = Math.floor(y), fx = x-ix, fy = y-iy;
  let sum = 0, cover = 0, shear = 0;
  for (let j=0;j<2;j++) for (let i=0;i<2;i++) {
    const k = (Math.min(H-1,iy+j)*W + (ix+i)%W)*2, w = (j ? fy : 1-fy)*(i ? fx : 1-fx);
    const a = data[k+m0], b = data[k+m1];
    if (a !== 255) { sum += a*w*(1-t); cover += w*(1-t); }
    if (b !== 255) { sum += b*w*t; cover += w*t; }
    shear += w*(data[k+m0+1]*(1-t) + data[k+m1+1]*t);
  }
  return {sst:cover > 0 ? sum/(5*cover)-2 : null, shear:shear*.25};
}
