// Portable, uniform-grid observer for browsers without half-float render
// targets. No dependence on DOM, camera, selected storm or fine-mesh windows.
import {MoistAtmosphere} from './cloud-field.js?v=global-39';
import {radiusOfMaximumWind, smooth} from './simulation.js';
import {unproject} from './map-math.js';
import {longitudeNoiseAxis,addNoiseRow} from './noise-grid.js';
const clip=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(v,i,j,k,l,a,b,c,d)=>a*v[i]+b*v[j]+c*v[k]+d*v[l];

export class CpuWorldObserver{
 constructor(f,factor=2){
   const w=this.width=f.width*factor,h=this.height=f.height*factor,n=w*h;this.factor=factor;
   const view=this.view=Object.create(MoistAtmosphere.prototype);
   Object.assign(view,{n,width:w,height:h,periodic:true,time:0,envFields:{sst:new Float32Array(n)},land:new Uint8Array(n),
     seaCooling:new Float32Array(n),temperature:new Float32Array(n),water:new Float32Array(n),convection:new Float32Array(n)});
   view.lat=Float32Array.from({length:h},(_,y)=>unproject(0,f.top+(y+.5)/h*(f.bottom-f.top)).latitude);
   view.kmx=Float32Array.from(view.lat,lat=>40030*Math.cos(lat*Math.PI/180)/w);
   view.kmy=Float32Array.from(view.lat,lat=>(f.bottom-f.top)*6371*Math.cos(lat*Math.PI/180)/h);
   this.previous=new Float32Array(n);this.previousActivity=new Float32Array(n);
   this.windX=new Float32Array(f.n);this.windY=new Float32Array(f.n);this.surface=new Float32Array(f.n);
   this.lastBase=new Float32Array(f.n);
   this.forcing=Array.from({length:4},()=>new Float32Array(n));
   this.x0=new Int32Array(w);this.x1=new Int32Array(w);this.frac=new Float32Array(w);
   for(let x=0;x<w;x++){const p=(x+.5)/factor-.5,j=Math.floor(p);this.x0[x]=(j+f.width)%f.width;
     this.x1[x]=(j+1)%f.width;this.frac[x]=p-j;}
   this.lons=Float64Array.from({length:w},(_,x)=>-180+360*(x+.5)/w);
   view.lon=this.lons;
   // Background subcolumns are sampled upstream along the local cloud wind.
   this.grain=new Float32Array(n);
   const cells=new Float64Array(w), axes=[256,768].map((k,i)=>longitudeNoiseAxis(this.lons,k/360,i?47:0));
   for(let y=0;y<h;y++){
     const baseY=(y+.5)/h;
     addNoiseRow(f.noiseValues,axes[0],baseY*256,.62,cells,true);
     addNoiseRow(f.noiseValues,axes[1],baseY*768+23,.38,cells,false);
     this.grain.set(cells,y*w);
   }
 }
 sources(f,systems,meshes){
   const v=this.view,w=this.width,h=this.height;
   const [u,north,rise,dry]=this.forcing;
   for(const a of this.forcing)a.fill(0);
   for(const s of systems){
     if(s.kind==='cloud'||s.kind==='anticyclone'||s.wind<7)continue;
     const nest=meshes?.get(s.id);
     const rm=radiusOfMaximumWind(s),R=Math.max(2.5*rm,Math.min(s.radius*1.45,nest?950:5*rm)),p=f.point(s.lon,s.lat);
     const cx=(p.x+.5)*this.factor-.5,cy=(p.y+.5)*this.factor-.5;
     const row=clip(Math.round(cy),0,h-1),kx=v.kmx[row],ky=v.kmy[row],rx=Math.min(w/2,R/kx);
     for(let y=Math.max(0,Math.floor(cy-R/ky));y<=Math.min(h-1,Math.ceil(cy+R/ky));y++)for(let x=Math.ceil(cx-rx);x<=Math.floor(cx+rx);x++){
       const i=y*w+((x%w+w)%w),dx=(x-cx)*kx,dy=(cy-y)*ky,r=Math.hypot(dx,dy);
       if(r>=R||r<.01)continue;
       const tx=dx/r,ty=dy/r,spin=Math.sign(s.lat)||1,Vel=s.wind*3.6*Math.min(r/rm,(rm/Math.max(r,rm))**.64)*(1-smooth(.55*R,R,r));
       const gain=Vel*(1-smooth(.6*rm,Math.max(2*rm,120),r));
       u[i]+=gain*(-ty*spin-.15*tx);north[i]+=gain*(tx*spin-.15*ty);
       const px=(x+.5)/this.factor-.5,py=(y+.5)/this.factor-.5;
       const rh=f.sample(f.vapor,px,py)/(3.8*Math.exp(.059*f.sample(f.temperature,px,py)));
       rise[i]+=.0032*Vel*(s.organization||0)*Math.exp(-(((r-rm)/(1.35*rm))**2))*smooth(.55,1,rh)*smooth(17,29,f.sample(f.envFields.sst,px,py));
       if(nest){
         const n=nest.point(this.lons[((x%w+w)%w)],v.lat[y]);
         const edge=Math.max(Math.abs((n.x+.5)/nest.width-.5),Math.abs((n.y+.5)/nest.height-.5))*2;
         if(edge<1)rise[i]+=.42*Math.max(0,nest.sample(nest.water,n.x,n.y)-f.sample(f.water,px,py))*(1-smooth(.65,1,edge))*(1-smooth(.55*R,R,r));
       }
       dry[i]+=(s.eye||0)*1.15*Math.exp(-((r/Math.max(5,rm*.80))**2));
     }
   }
 }
 update(f,systems,meshes){
   this.view.seasonDay=f.seasonDay;
   const time=f.time,init=this.time==null,dt=init?0:time-this.time;
   if(!init&&dt<=0&&this.injection===f.injectionRevision&&this.env===f.envRevision)return;
   const v=this.view,w=v.width,h=v.height,pw=f.width,e=f.envFields;
   this.sources(f,systems,meshes);
   const [du,dv,lift,sink]=this.forcing,wx=this.windX,wy=this.windY,surface=this.surface;
   for(let i=0;i<f.n;i++){
     wx[i]=f.u[i]+e.upperU[i];wy[i]=f.v[i]+e.upperV[i];surface[i]=f.land[i]?f.soilHeat[i]:e.sst[i]-f.seaCooling[i];
   }
   const water=this.previous,activity=this.previousActivity,old=v.water,prior=v.convection;
   const sourceResponse=-Math.expm1(-dt/3.8), convResponse=-Math.expm1(-dt/1.5);
   const age=time%12, parcel=smooth(0,12,age);
   for(let y=0,i=0;y<h;y++){
     const py=clip((y+.5)/this.factor-.5,0,f.height-1.001),iy=Math.floor(py),fy=py-iy;
     const row=iy*pw;
     for(let x=0;x<w;x++,i++){
       const j=row+this.x0[x],k=row+this.x1[x],l=j+pw,z=k+pw,fx=this.frac[x];
       const a=(1-fx)*(1-fy),b=fx*(1-fy),c=(1-fx)*fy,d=fx*fy;
       const q=mix(f.water,j,k,l,z,a,b,c,d),ac=mix(f.convection,j,k,l,z,a,b,c,d);
       const rh=.01*mix(e.humidity,j,k,l,z,a,b,c,d), buoy=mix(e.convectiveActivity,j,k,l,z,a,b,c,d);
       v.temperature[i]=mix(f.temperature,j,k,l,z,a,b,c,d);
       v.envFields.sst[i]=mix(surface,j,k,l,z,a,b,c,d);
       const mx=mix(wx,j,k,l,z,a,b,c,d)/v.kmx[y], my=mix(wy,j,k,l,z,a,b,c,d)/v.kmy[y];
       const ux=mx+du[i]/v.kmx[y],vy=my+dv[i]/v.kmy[y];
       const oldGrain=v.sample(this.grain,x-(age+12)*mx,y+(age+12)*my);
       const n=oldGrain+(v.sample(this.grain,x-age*mx,y+age*my)-oldGrain)*parcel-.5;
       const cells=ac/(Math.max(ac,0)+.045),partial=1-smooth(.08,.45,q);
       const spread=(1.22+1.45*Math.max(cells,.92*partial)+.34*cells)*clip(.55+.30*rh+.15*buoy,.50,1.15);
       const target=Math.max(0,q*(1+spread*n));
       if(init){water[i]=target;activity[i]=ac;continue;}
       const bx=x-ux*dt,by=clip(y+vy*dt,0,h-1.001);
       const xx=Math.floor(bx),yy=Math.floor(by),left=((xx%w)+w)%w, jj=yy*w+left,rr=yy*w+(left+1)%w;
       const ax=bx-xx,ay=by-yy,aa=(1-ax)*(1-ay),bb=ax*(1-ay),cc=(1-ax)*ay,dd=ax*ay;
       const adv=mix(old,jj,rr,jj+w,rr+w,aa,bb,cc,dd),cv=mix(prior,jj,rr,jj+w,rr+w,aa,bb,cc,dd);
       const cond=lift[i]*Math.max(.25,1+.85*n);
       const injected=dt===0?q-mix(this.lastBase,j,k,l,z,a,b,c,d):0;
       water[i]=clip((adv+(target-adv)*sourceResponse+cond*dt+injected)*Math.exp(-sink[i]*dt),0,8);
       activity[i]=clip(cv+(Math.max(0,ac*(1+1.6*n)+cond*.24)-cv)*convResponse,0,6);
     }
   }
   v.water=water;this.previous=old;v.convection=activity;this.previousActivity=prior;
   v.time=time;v.lightTime=-Infinity;this.lastBase.set(f.water);
   this.time=time;this.injection=f.injectionRevision;this.env=f.envRevision;
 }
 pixels(layer){return this.view.pixels(layer,1,this.view.water);}
}
