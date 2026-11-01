// Enhancement curves in °C, read from Dapiya's BW, BD and RBTOP floater
// legends. These transform simulated brightness temperature, never wind speed.
export const isInfrared = key => ['infrared','ir-bw','ir-bd','ir-rbtop'].includes(key);
const gray = value => [value,value,value];
// A map overlay, unlike the opaque full-scene RBTOP product. The warm end
// fades out; cold thick cloud must not lose contrast against the basemap.
const red = [[-90,56,4,18,255],[-80,98,9,29,255],[-73,148,23,41,255],
  [-63,210,54,58,253],[-53,247,131,103,248],[-43,251,208,166,228],
  [-33,222,235,189,204],[-23,163,220,170,167],[-13,96,191,148,113],
  [-3,85,180,142,54],[8,85,180,142,0]];
const rainbow = [[-100,255,255,255],[-90,157,157,157],[-80,59,59,59],[-76,0,0,0],
  [-66,255,0,0],[-56,255,255,0],[-46,0,255,0],[-27,0,0,255],[-17,255,0,255],
  [-15,247,235,250],[-14,244,244,244],[5,105,105,105],[10,92,92,92],
  [25,4,4,4],[26,0,0,0],[26.1,121,121,121],[50,0,0,0]];
const convection = [[0,150,150,150],[.18,205,205,205],[.39,242,229,155],
  [.58,255,185,65],[.78,237,89,44],[1,154,27,57]];
function interpolate(stops,x,channels=3) {
  let i=1;
  while(i<stops.length-1 && x>stops[i][0]) i++;
  const a=stops[i-1], b=stops[i], f=Math.max(0,Math.min(1,(x-a[0])/(b[0]-a[0])));
  return Array.from({length:channels},(_,j)=>Math.round(a[j+1]+f*(b[j+1]-a[j+1])));
}
// BD intentionally has hard steps: smoothing them would erase temperature classes.
function bd(t) {
  if(t<=-81) return 85;
  if(t<=-76) return 135;
  if(t<=-70) return 255;
  if(t<=-64) return 0;
  if(t<=-54) return 160;
  if(t<=-42) return 110;
  if(t<=-32) return 60;
  if(t<9) return Math.round(130-2.34*t);
  return Math.round(Math.max(0,255-(t-9)*13.6));
}
export function scaleColor(key,x) {
  if(key==='ir-bd') return gray(bd(x));
  if(key==='ir-bw') return gray(Math.round(255*Math.max(0,Math.min(1,(50-x)/135))));
  return interpolate(key==='convection'?convection:key==='ir-rbtop'?rainbow:red,x);
}
export function scaleRGBA(key,x) {
  return key==='infrared' ? interpolate(red,x,4) : [...scaleColor(key,x),255];
}
