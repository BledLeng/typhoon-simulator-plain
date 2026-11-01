// Simulated UTC and the model's 365-day calendar. NOAA GML fractional-year
// solar approximation: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
const rad=Math.PI/180, tau=2*Math.PI;
export function solarPosition(hours,seasonDay=240){
  const g=tau/365*(seasonDay-1+(hours-12)/24);
  const decl=.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)
    +.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.001480*Math.sin(3*g);
  const minutes=229.18*(.000075+.001868*Math.cos(g)-.032077*Math.sin(g)
    -.014615*Math.cos(2*g)-.040849*Math.sin(2*g));
  const lon=(180-15*(hours%24)-minutes/4)*rad;
  return {decl,lon:Math.atan2(Math.sin(lon),Math.cos(lon)),sinDecl:Math.sin(decl),cosDecl:Math.cos(decl)};
}

// Feather the visible/thermal boundary from -6° to +6° solar elevation.
export const TWILIGHT_SINE=Math.sin(6*rad);
export function daylight(sineAltitude){
  const t=Math.max(0,Math.min(1,.5+.5*sineAltitude/TWILIGHT_SINE));
  return t*t*(3-2*t);
}

// Two independent branches in Sun-relative Mercator coordinates. Neither
// branch crosses a seam or needs a closing chord over a pole.
export function horizonArcs(decl,segments=256){
  const sd=Math.sin(decl),cd=Math.cos(decl);
  const end=Math.asin(Math.min(1,Math.sin(85*rad)/cd));
  const branches=[[],[]];
  for(let i=0;i<=segments;i++){
    const t=end*(2*i/segments-1),s=Math.sin(t);
    const x=Math.atan2(Math.cos(t),-sd*s),y=-Math.atanh(cd*s);
    branches[0].push([x,y]);branches[1].push([-x,y]);
  }
  return branches;
}

export class TerminatorLine {
  draw(ctx,sun,project,scale,width){
    const decl=Math.round(sun.decl*1e5)/1e5;
    if(this.decl!==decl){
      const path=new Path2D();
      for(const arc of horizonArcs(decl)){
        path.moveTo(...arc[0]);
        for(let i=1;i<arc.length;i++)path.lineTo(...arc[i]);
      }
      this.path=path;this.decl=decl;
    }
    const {x,y}=project(sun.lon/rad,0,false),world=tau*scale;
    const first=Math.ceil((-x-world/2)/world),last=Math.floor((width-x+world/2)/world);
    ctx.save();
    ctx.translate(x+first*world,y);ctx.scale(scale,scale);
    ctx.lineWidth=1/scale;ctx.strokeStyle='rgba(255,209,125,.90)';
    for(let i=first;i<=last;i++){ctx.stroke(this.path);ctx.translate(tau,0);}
    ctx.restore();
  }
}
