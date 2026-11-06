// Reduced-order moist boundary layer beneath an eye's subsidence inversion.
// Not a cloud decal or a missing satellite scan. Advect vapour and condensate
// on the existing moving numerical nest; condensation transfers water between
// them. Marine exchange and drizzle are explicit source/sink terms. This layer
// does not masquerade as deep convection or feed the intensity diagnostic.
import {radiusOfMaximumWind, smooth} from './simulation.js?v=eye-42';
const cap=(x,a,b)=>Math.max(a,Math.min(b,x));
const saturation=t=>3.8*Math.exp(.059*t);
export const lowCloudHeight=w=>.45+.95*w/(w+.08);
export const lowCloudVisibleAlpha=w=>-Math.expm1(-5*Math.max(0,w));

export function advanceEyeLowCloud(f,storms,dt){
  if(!(dt>0))return;
  f.eyeWater??=new Float32Array(f.n);f.eyeVapor??=new Float32Array(f.n);
  f.eyeNext??=[new Float32Array(f.n),new Float32Array(f.n)];
  const hosts=storms.filter(s=>s.kind==='disturbance'&&s.eye>.10&&!s.absorbedBy).map(s=>{
    const p=f.point(s.lon,s.lat),r=radiusOfMaximumWind(s);
    return {x:p.x,y:p.y,r,gate:smooth(.10,.65,s.eye)*(1-(s.transition||0))};
  });
  if(!hosts.length&&!f.eyeWater.some(w=>w>1e-5)&&!f.eyeVapor.some(q=>q>1e-5))return;
  const steps=Math.max(1,Math.ceil(dt/.25)),h=dt/steps,exchange=-Math.expm1(-h/.9),phase=-Math.expm1(-h/.45);
  const inputs=f.eyeInputs??=new Float32Array(f.n*2);
  // Build forcing once per physical tick, never per camera or product switch.
  for(let y=0,i=0;y<f.height;y++)for(let x=0;x<f.width;x++,i++){
    let gate=0;
    for(const s of hosts){const r=Math.hypot((x-s.x)*f.kmx[y],(y-s.y)*f.kmy[y]);
      gate=Math.max(gate,s.gate*(1-smooth(.38,.80,r/s.r)));}
    const surface=f.envFields.sst[i]-f.seaCooling[i],rh=cap(f.envFields.humidity[i]/100,0,1);
    // A broad humidity anomaly plus smaller thermals, both Earth-anchored and
    // continuous in time. No guaranteed half-disc or forced cloud in dry air.
    const grain=.65*f.forcingNoise(f.lon[x]*5.2+f.time*.027,f.lat[y]*5.2)
      +.35*f.forcingNoise(f.lon[x]*.43,f.lat[y]*.43-f.time*.011);
    const temperature=surface-5.4-1.8*(grain-.5);
    const supply=gate*(f.land[i]?0:1)*smooth(18,28,surface);
    inputs[2*i]=saturation(temperature);
    inputs[2*i+1]=supply*saturation(surface-2)*rh*(.87+.25*grain);
  }
  for(let step=0;step<steps;step++){
    const [water,vapor]=f.eyeNext,old=f.eyeWater,prior=f.eyeVapor;
    for(let y=0,i=0;y<f.height;y++)for(let x=0;x<f.width;x++,i++){
      // Low-level winds only: deliberately exclude the upper-air outflow.
      const bx=cap(x-f.u[i]*h/f.kmx[y],0,f.width-1.001),by=cap(y+f.v[i]*h/f.kmy[y],0,f.height-1.001);
      let w=f.sample(old,bx,by),q=f.sample(prior,bx,by);
      q+=(inputs[2*i+1]-q)*exchange;
      const sat=inputs[2*i];
      const cond=Math.min(Math.max(0,.24-w),Math.max(0,q-sat)*phase*.12);
      const evap=Math.min(w,Math.max(0,sat-q)*phase*.18);
      q+=evap-cond;w+=cond-evap;
      water[i]=Math.max(0,w*Math.exp(-h/3.2));vapor[i]=Math.max(0,q);
    }
    f.eyeWater=water;f.eyeVapor=vapor;f.eyeNext=[old,prior];
  }
}
