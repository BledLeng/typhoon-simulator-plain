// A seeded, periodic humidity anomaly carried by the local low-level wind.
// Overlap successive air masses so a change of epoch never restarts the sky.
const eased = t => t*t*(3-2*t);
const wrap = (x,n) => (x%n+n)%n;
function corner(x,y,seed) {
  let h = Math.imul(x,0x632be5ab) ^ Math.imul(y,0x85157af5) ^ seed;
  h = Math.imul(h ^ h>>>16,0x21f0aaad);
  h = Math.imul(h ^ h>>>15,0x735a2d97);
  return ((h ^ h>>>15)>>>0)/4294967296;
}
function lattice(lon,lat,columns,seed) {
  const x = lon*columns/360, y = lat*columns/260;
  const i = Math.floor(x), j = Math.floor(y), a = eased(x-i), b = eased(y-j);
  const left=wrap(i,columns), right=(left+1)%columns;
  const p=corner(left,j,seed),q=corner(left,j+1,seed);
  return (p+(corner(right,j,seed)-p)*a)*(1-b)+(q+(corner(right,j+1,seed)-q)*a)*b;
}
export function moistureEnvelope(seed,lon,lat,hours,u,v) {
  const period=48, epoch=Math.floor(hours/period), t=hours-epoch*period;
  const dx=u/(111.2*Math.max(.18,Math.cos(lat*Math.PI/180))), dy=v/111.2;
  const parcel=(age,k)=>{
    const x=lon-age*dx,y=lat-age*dy,s=seed^Math.imul(k,0x27d4eb2d);
    return .65*lattice(x,y,23,s)+.35*lattice(x+8,y-3,49,s^0x1b873593);
  };
  const f=eased(t/period);
  return parcel(t,epoch)*f+parcel(t+period,epoch-1)*(1-f);
}
