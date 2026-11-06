// Two sunward samples through the simulated cloud roof. Distances are km,
// not screen pixels; the same projection works while panning and zooming.
import {solarPosition} from './day-night.js?v=global-39';
import {lowCloudVisibleAlpha} from './eye-low-cloud.js';

const NEAR=3.5, FAR=9, FLOOR=.17, MIN_SUN=.015, FULL_SUN=.24;
const STUDIO=[-.74,-.60,.32]; // east, south, up; fixed light for all-day cloud water
const rad=Math.PI/180;
const sat=x=>Math.max(0,Math.min(1,x));
const ramp=x=>{const t=sat(x);return t*t*(3-2*t);};
const glNum=n=>n.toFixed(4);

// Height and coverage both matter: a dry column has no casting surface,
// however large its residual convective activity. A proxy, not 3-D ray tracing.
function roof(w,c,trop){
  return w<=0?0:w/(w+.13)*Math.min(trop,1.2+3*w/(w+.6)+c/(c+.045)*(trop-3));
}

export const cloudShadowGLSL=`
float roof(vec2 wc,float trop){
  vec2 t=max(vec2(0.),wc);
  return t.x/(t.x+.13)*min(trop,1.2+3.*t.x/(t.x+.6)+t.y/(t.y+.045)*(trop-3.));
}
vec2 columnAt(vec2 p){
  vec2 wc=texture(history,p).rg;
  wc.x=max(0.,wc.x+texture(deviationsMap,p).r);
  return wc;
}
vec4 visibleCloud(vec2 p,vec2 wc,vec3 sun,vec2 km,float trop,float a){
  vec2 ray=sun.xy/(max(sun.z,${glNum(FLOOR)})*km);
  float here=roof(wc,trop);
  float d1=roof(columnAt(p+${glNum(NEAR)}*ray),trop)-here;
  float d2=roof(columnAt(p+${glNum(FAR)}*ray),trop)-here;
  float direct=smoothstep(${glNum(MIN_SUN)},${glNum(FULL_SUN)},sun.z);
  float shade=direct*max(.48*smoothstep(.60,4.6,d1),.42*smoothstep(3.8,11.,d2));
  // Retain the small relief on dense eyewalls where roof height saturates.
  vec2 cell=1./vec2(textureSize(history,0));
  vec2 slope=(vec2(columnAt(p+vec2(cell.x,0.)).x,columnAt(p+vec2(0.,cell.y)).x)-wc.x)/(km*cell);
  float facing=90.*dot(slope,sun.xy);
  float light=.958-direct*(.15*facing/(1.+abs(facing))+.060*clamp(d1/3.5,-.45,1.))-.62*shade;
  // A translucent receiver reveals the surface below it. Test the same
  // blockers against ground level as well, not just against this cloud top.
  float ground=direct*max(.34*smoothstep(1.8,8.5,here+d1),.26*smoothstep(5.,13.,here+d2));
  float under=(1.-a)*max(shade,ground);
  vec4 high=vec4(min(vec3(1.),vec3(light)+vec3(0.,.012,.024))*a+
              vec3(.085,.125,.19)*under,a+under);
  float low=max(0.,texture(deviationsMap,p).g);
  float lowAlpha=(1.-high.a)*(1.-exp(-5.*low));
  vec3 lowLight=vec3(.80,.825,.85)+.10*clamp(sun.z,0.,1.);
  return high+vec4(lowLight*lowAlpha,lowAlpha);
}`;
export const studioLightGLSL='vec3('+STUDIO.map(glNum).join(',')+')';

function sample(v,w,h,x,y){
  // Both axes bilinear, longitude periodic, latitude clamped at the poles.
  x-=w*Math.floor(x/w); y=Math.max(0,Math.min(h-1,y));
  const ix=Math.floor(x),iy=Math.floor(y),j=iy*w+ix;
  const next=ix+1===w?1-w:1,down=iy+1===h?0:w;
  const fx=x-ix,fy=y-iy;
  const a=v[j]+fx*(v[j+next]-v[j]),b=v[j+down]+fx*(v[j+down+next]-v[j+down]);
  return a+fy*(b-a);
}

// For a fixed azimuth every longitude in a row uses the same stencil.
function stencil(w,h,y,dx,dy){
  const sx=Math.floor(dx),yy=Math.max(0,Math.min(h-1,y+dy)),sy=Math.floor(yy);
  return {sx,fx:dx-sx,fy:yy-sy,row:sy*w,next:Math.min(sy+1,h-1)*w};
}
function rowSample(v,w,x,s){
  let ix=(x+s.sx)%w;if(ix<0)ix+=w;
  const j=s.row+ix,k=s.next+ix,off=ix+1===w?1-w:1;
  const a=v[j]+s.fx*(v[j+off]-v[j]),b=v[k]+s.fx*(v[k+off]-v[k]);
  return a+s.fy*(b-a);
}

// RGBA is straight on CPU (ImageData), premultiplied on GPU. Cache only the
// diagnosed geometry, never the sun angle or a screen-sized shadow bitmap.
export function visiblePixels(f,solar,cache){
  const {width:w,height:h,water,convection}=f,roofKm=cache.roofKm??=new Float32Array(f.n);
  const valid=cache.water===water&&cache.time===f.time&&cache.revision===f.injectionRevision;
  const sun=solar?solarPosition(f.time,f.seasonDay):null;
  const pixels=new Uint8ClampedArray(f.n*4),opacity=cache.opacity??=new Float32Array(f.n);
  const sinHA=solar?(cache.sinHA??=new Float64Array(w)):null,cosHA=solar?(cache.cosHA??=new Float64Array(w)):null;
  if(solar)for(let x=0;x<w;x++){
    const ha=f.lon[x]*rad-sun.lon;sinHA[x]=Math.sin(ha);cosHA[x]=Math.cos(ha);
  }
  if(!valid){
    for(let y=0,i=0;y<h;y++){
      const trop=17-6*Math.abs(Math.sin(f.lat[y]*rad));
      for(let x=0;x<w;x++,i++){
        const q=Math.max(0,water[i]);roofKm[i]=roof(q,Math.max(0,convection[i]),trop);
        opacity[i]=q>0?1-Math.exp(-2.6*q):0;
      }
    }
    cache.water=water;cache.time=f.time;cache.revision=f.injectionRevision;
  }
  for(let y=0,i=0;y<h;y++){
    const sl=Math.sin(f.lat[y]*rad),cl=Math.cos(f.lat[y]*rad),kx=1/f.kmx[y],ky=1/f.kmy[y];
    const fixedX=STUDIO[0]/STUDIO[2]*kx,fixedY=STUDIO[1]/STUDIO[2]*ky;
    const near=solar?null:stencil(w,h,y,NEAR*fixedX,NEAR*fixedY);
    const far=solar?null:stencil(w,h,y,FAR*fixedX,FAR*fixedY);
    const south=y+1===h?0:w,north=y===0?0:-w;
    for(let x=0;x<w;x++,i++){
      const mu=solar?sl*sun.sinDecl+cl*sun.cosDecl*cosHA[x]:STUDIO[2];
      // Night pixels are supplied by the existing thermal product.
      if(solar&&mu<-.105)continue;
      const den=1/Math.max(mu,FLOOR);
      const east=solar?-sun.cosDecl*sinHA[x]:STUDIO[0], southward=solar?sl*sun.cosDecl*cosHA[x]-cl*sun.sinDecl:STUDIO[1];
      const dx=east*kx*den,dy=southward*ky*den;
      const here=roofKm[i],ax=Math.abs(FAR*dx),ay=Math.abs(FAR*dy);
      let d1,d2;
      if(ax<=1&&ay<=1){
        // Both probes lie in one cell on most of the CPU globe. Evaluate the
        // same bilinear polynomial at two distances from its receiver corner.
        const ox=dx<0?(x===0?w-1:-1):(x+1===w?1-w:1),oy=dy<0?north:south;
        const vx=roofKm[i+ox]-here,vy=roofKm[i+oy]-here;
        const linear=ax*vx+ay*vy,cross=ax*ay*(roofKm[i+ox+oy]-here-vx-vy);
        d2=linear+cross;d1=(NEAR/FAR)*(linear+(NEAR/FAR)*cross);
      }else{
        d1=(solar?sample(roofKm,w,h,x+NEAR*dx,y+NEAR*dy):rowSample(roofKm,w,x,near))-here;
        d2=(solar?sample(roofKm,w,h,x+FAR*dx,y+FAR*dy):rowSample(roofKm,w,x,far))-here;
      }
      const low= Math.max(0,f.eyeWater?.[i]||0);
      if(!here&&d1<=.60&&d2<=3.8&&!low)continue;
      const direct=solar?ramp((mu-MIN_SUN)/(FULL_SUN-MIN_SUN)):1;
      const shade=direct*Math.max(.48*ramp((d1-.60)/4),.42*ramp((d2-3.8)/7.2));
      const q=water[i],facing=90*(east*(water[i+(x+1===w?1-w:1)]-q)*kx+southward*(water[i+south]-q)*ky);
      const light=.958-direct*(.15*facing/(1+Math.abs(facing))+.060*Math.max(-.45,Math.min(1,d1/3.5)))-.62*shade;
      const ground=direct*Math.max(.34*ramp((here+d1-1.8)/6.7),.26*ramp((here+d2-5)/8));
      const a=opacity[i],under=(1-a)*Math.max(shade,ground),highAlpha=a+under,k=i*4;
      const lowAlpha=(1-highAlpha)*lowCloudVisibleAlpha(low),alpha=highAlpha+lowAlpha;
      if(!alpha)continue;
      const gain=255/alpha;
      pixels[k]=(Math.min(1,light)*a+.085*under+(.80+.10*sat(mu))*lowAlpha)*gain;
      pixels[k+1]=(Math.min(1,light+.012)*a+.125*under+(.825+.10*sat(mu))*lowAlpha)*gain;
      pixels[k+2]=(Math.min(1,light+.024)*a+.19*under+(.85+.10*sat(mu))*lowAlpha)*gain;
      pixels[k+3]=255*alpha;
    }
  }
  return pixels;
}
