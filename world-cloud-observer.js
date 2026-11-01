// One global satellite observation mesh, including clear air. A cyclone can
// force wind/ascent in this mesh, but it cannot supply an image or erase a tile.
import {radiusOfMaximumWind} from './simulation.js';
import {scaleRGBA} from './satellite-scales.js?v=global-39';
import {solarPosition,TWILIGHT_SINE} from './day-night.js?v=global-39';
import {random} from './simulation.js';

const vertex=`#version 300 es
out vec2 uv;
uniform vec4 box;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
uv=box.xy+p*box.zw;gl_Position=vec4(uv*2.-1.,0.,1.);}`;
const head=`#version 300 es
precision highp float;in vec2 uv;out vec4 outp;
uniform sampler2D field,wind,previousField,history,noiseMap,forces,palette;
uniform float dt,clock,first,worldTop,worldSpan;
uniform vec2 metric;
float smoothNoise(vec2 q){vec2 p=q*256.-.5;vec2 f=fract(p);return texture(noiseMap,(floor(p)+f*f*(3.-2.*f)+.5)/256.).r;}
`;
// Bake seeded subcolumn variability once. It contains no cloud shape or
// background water: in a dry column it produces no cloud at all.
const material=head+`
void main(){
 // Warp the subcolumns, not the satellite image. A continuous parcel
 // envelope breaks up the square lattice without stamping holes in a deck.
 vec2 warp=vec2(smoothNoise(uv+.27),smoothNoise(uv+.61))-.5;
 vec2 p=uv+warp*.004;
 float a=smoothNoise(p), b=smoothNoise(p*3.+vec2(.31,.63));
 float c=smoothNoise(p*vec2(6.,7.)+vec2(.71,.14));
 outp=vec4(.57*a+.32*b+.11*c,0.,0.,1.);
}`;
const dynamics=head+`
uniform sampler2D prediction;
void main(){
 vec4 b=texture(field,uv),m=texture(wind,uv),g=texture(forces,uv);
 float merc=worldTop+uv.y*worldSpan, cs=1./cosh(merc);
 vec2 km=metric*cs;
 vec2 flow=(m.xy+g.xy)*vec2(1.,-1.)/km;
 vec2 back=vec2(fract(uv.x-flow.x*dt),clamp(uv.y-flow.y*dt,0.,1.));
 vec2 old=texture(prediction,uv).rg;
 if(first<.5 && dt>0.){
   vec2 forward=uv+flow*dt;
   vec2 err=.5*(texture(history,uv).rg-texture(prediction,forward).rg);
   vec2 grid=vec2(textureSize(history,0)),k=(floor(back*grid-.5)+.5)/grid;
   vec2 px=1./grid;
   vec2 a=texture(history,k).rg,b0=texture(history,k+vec2(px.x,0)).rg;
   vec2 c=texture(history,k+vec2(0,px.y)).rg,d=texture(history,k+px).rg;
   old=clamp(old+err,min(min(a,b0),min(c,d)),max(max(a,b0),max(c,d)));
 }
 // Subcolumn humidity varies continuously on the WHOLE globe. Material is
 // transported with the diagnosed cloud-level wind, not rotated as artwork.
 // Two overlapping air parcels follow local winds. A 12-hour handover has
 // continuous value and velocity; there is no globally scrolling noise.
 float age=mod(clock,12.),f=smoothstep(0.,12.,age);
 vec2 transport=m.xy*vec2(1.,-1.)/km;
 float grain=mix(texture(noiseMap,uv-transport*(age+12.)).r,
                 texture(noiseMap,uv-transport*age).r,f)-.5;
 // Stratiform overcast has a continuous roof. Sharper cell-to-cell
 // departures belong where the solver actually diagnoses rising condensate.
 float cellFraction=b.g/(max(b.g,0.)+.045);
 float partial=1.-smoothstep(.08,.45,b.r);
 float spread=(1.22+1.45*max(cellFraction,.92*partial)+.34*cellFraction)*clamp(.55+.30*m.z+.15*m.w,.50,1.15);
 float target=max(0.,b.r*(1.+spread*grain));
 // Inner-core vertical motion is a *rate*. No switching, blending in a fine
 // image, or replacing a cloudy column with an empty one on mesh arrival.
 float cond=g.z*max(.25,1.+.85*grain);
 float liquid=first>.5?target:mix(old.x,target,1.-exp(-dt/2.8));
 if(first<.5 && dt==0.)liquid+=b.r-texture(previousField,uv).r;
 liquid=(liquid+cond*dt)*exp(-max(0.,g.w)*dt);
 float activity=first>.5?b.g:mix(old.y,max(0.,b.g*(1.+1.6*grain)+cond*.24),1.-exp(-dt/1.5));
 outp=vec4(clamp(liquid,0.,8.),clamp(activity,0.,6.),0.,1.);
}`;
const predict=head+`
void main(){
 vec2 km=metric/cosh(worldTop+uv.y*worldSpan);
 vec2 v=(texture(wind,uv).xy+texture(forces,uv).xy)*vec2(1.,-1.)/km;
 outp=vec4(texture(history,uv-v*dt).rg,0.,1.);
}`;
const vortex=head+`
uniform vec4 host; // continuous centre, circulation radius km, RMW km
uniform vec4 state; // wind km/h, signed rotation, organization, eye ventilation
uniform sampler2D columns;
uniform vec4 footprint;
uniform int deviations;
void main(){
 vec2 d=vec2(fract(uv.x-host.x+.5)-.5,uv.y-host.y)*metric/cosh(worldTop+host.y*worldSpan);
 d.y=-d.y;float r=length(d),R=host.z,rm=host.w;
 if(r>=R||r<.01)discard;
 vec2 unit=d/r,dn=vec2(-unit.y,unit.x)*state.y;
 float taper=1.-smoothstep(.55*R,R,r);
 float v=state.x*min(r/rm,pow(rm/max(r,rm),.64))*taper;
 // The coarse wind already contains the broad circulation. Restore only
 // unresolved shear inside roughly two parent cells, and low-level inflow.
 float gain=1.-smoothstep(.6*rm,max(2.*rm,120.),r);
 vec2 vel=v*gain*(dn-.15*unit);
 float fineWater=0.;
 vec2 location=vec2(fract(uv.x),uv.y);
 vec4 ambient=texture(field,location),motion=texture(wind,location);
 float ascent=.0032*v*state.z*exp(-pow((r-rm)/(1.35*rm),2.))
     *smoothstep(.55,1.,motion.z)*smoothstep(17.,29.,ambient.a);
 if(footprint.z>0.){
   vec2 q=vec2(fract(uv.x-footprint.x+.5)-.5,uv.y-footprint.y)/footprint.zw+.5;
   float edge=max(abs(q.x-.5),abs(q.y-.5))*2.;
   if(edge<1.){
     vec2 column=texture(columns,q).rg;
     // Only the sub-footprint departure; a uniformly dry nest contributes
     // zero. Never replace the background with a rectangular cloud picture.
     vec2 dd=clamp(vec2(38.)/(footprint.zw*metric/cosh(worldTop+host.y*worldSpan)),vec2(.012),vec2(.22));
     float mean=(texture(columns,q+vec2(dd.x,0)).r+texture(columns,q-vec2(dd.x,0)).r+
                 texture(columns,q+vec2(0,dd.y)).r+texture(columns,q-vec2(0,dd.y)).r+
                 texture(columns,q+dd*.71).r+texture(columns,q-dd*.71).r+
                 texture(columns,q+vec2(dd.x,-dd.y)*.71).r+texture(columns,q-vec2(dd.x,-dd.y)*.71).r)*.125;
     // Do not high-pass sharpen every inner rainband into a white wire.
     float cellular=ambient.g/(ambient.g+.045);
     fineWater=(column.x-mean)*(.52+.32*cellular)*(1.-smoothstep(.60,1.,edge))*taper;
     // Excess condensate supplies a positive detrainment rate. A dry nest
     // cannot replace an overlying deck, even if its entire interior is dry.
     ascent+=max(0.,column.x-ambient.r)*.42*(1.-smoothstep(.65,1.,edge))*taper;
   }
 }
 float drying=state.w*1.15*exp(-pow(r/max(5.,rm*.80),2.));
 outp=deviations==1?vec4(fineWater,0.,0.,1.):vec4(vel,ascent,drying);
}`;
const display=head+`
uniform int product;
uniform vec3 solar; // subsolar longitude, sin(declination), cos(declination)
uniform sampler2D deviationsMap;
float waterAt(vec2 p){return max(0.,texture(history,p).r+texture(deviationsMap,p).r);}
float rad(float t){return 1./(exp(1396.87/(t+273.15))-1.);}
void main(){
 // GL canvas is presented top down; solver row zero is north.
 vec2 p=vec2(uv.x,1.-uv.y);
 vec2 s=texture(history,p).rg;vec4 b=texture(field,p);
 float w=waterAt(p),c=max(s.y,0.),a=1.-exp(-2.6*w);
 float merc=worldTop+p.y*worldSpan;
 float day=1.;
 if(product==4){
   float mu=-tanh(merc)*solar.y+cos((p.x-.5)*6.28318530718-solar.x)*solar.z/cosh(merc);
   day=smoothstep(-${TWILIGHT_SINE},${TWILIGHT_SINE},mu);
 }
 vec4 visible=vec4(0.);
 if(product==0||(product==4&&day>0.)){
   vec2 cell=1./vec2(textureSize(history,0));float cs=1./cosh(worldTop+p.y*worldSpan);
   float dx=(waterAt(p-vec2(cell.x,0))-waterAt(p+vec2(cell.x,0)))*60./(cell.x*metric.x*cs);
   float dy=(waterAt(p-vec2(0,cell.y))-waterAt(p+vec2(0,cell.y)))*60./(cell.y*metric.y*cs);
   vec2 n=clamp(vec2(dx,dy),-.65,.65);
   float light=(222.+34.*max(0.,(.7-dot(n,vec2(.45,.55)))/sqrt(1.+dot(n,n))))/255.;
   visible=vec4(clamp(vec3(light)+vec3(0.,3.,6.)/255.,0.,1.)*a,a);
   if(product==0||day>=1.){outp=visible;return;}
 }
 float e=1.-exp(-2.8*w),act=c/(c+.045);
 float level;
 if(product==1){level=act*e;a=e*(.35+.65*act);}
 else{
   float trop=17.-6.*abs(tanh(worldTop+p.y*worldSpan));
   float top=max(-90.,min(b.a,b.b-6.2*min(trop,1.2+3.*w/(w+.6)+act*(trop-3.))));
   float mixed=mix(rad(b.a),rad(top),e);
   float tb=1396.87/log(1.+1./mixed)-273.15;
   if(product==4){
     float cold=clamp((20.-tb)/100.,0.,1.);
     float cloud=e*(.35+.65*cold),clear=.82*(1.-cloud);
     vec3 night=(cloud*(vec3(103.,120.,145.)+cold*vec3(139.,126.,105.))+clear*vec3(6.,17.,32.))/255.;
     outp=mix(vec4(night,cloud+clear),visible,day);return;
   }
   level=clamp((tb+100.)/160.,0.,1.);
   a=product==2?e:1.;
 }
 vec4 swatch=texture(palette,vec2((level*1023.+.5)/1024.,.5));
 a*=swatch.a;
 outp=vec4(swatch.rgb*a,a);
}`;

export class WorldCloudObserver {
 static create(field){
   if(typeof OffscreenCanvas==='undefined')return null;
   let gl;
   try{
     const canvas=new OffscreenCanvas(field.width*4,field.height*4);
     gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false});
     if(!gl || !gl.getExtension('EXT_color_buffer_float'))return null;
     return new WorldCloudObserver(canvas,gl,field);
   }catch(e){console.warn('Uniform cloud observation falling back to the global CPU grid:',String(e));gl?.getExtension('WEBGL_lose_context')?.loseContext();return null;}
 }
 constructor(canvas,gl,f){
   this.canvas=canvas;this.gl=gl;this.time=null;this.width=canvas.width;this.height=canvas.height;
   this.programs=[dynamics,vortex,display,predict,material].map(fragment=>{
     const p=gl.createProgram();
     for(const [kind,code] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
       const s=gl.createShader(kind);gl.shaderSource(s,code);gl.compileShader(s);
       if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
       gl.attachShader(p,s);gl.deleteShader(s);
     }
     gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
     const u={};for(const name of ['box','dt','clock','first','worldTop','worldSpan','metric','host','state','product','field','wind','history','noiseMap','forces','palette','previousField','columns','footprint'])u[name]=gl.getUniformLocation(p,name);
     gl.useProgram(p);for(const [i,name] of ['field','wind','history','noiseMap','forces','palette','previousField','columns'].entries())gl.uniform1i(u[name],i);
     for(const [name,unit] of [['prediction',8],['deviationsMap',9]]){u[name]=gl.getUniformLocation(p,name);gl.uniform1i(u[name],unit);}
     u.deviations=gl.getUniformLocation(p,'deviations');
     u.solar=gl.getUniformLocation(p,'solar');
     gl.uniform1f(u.worldTop,f.top);gl.uniform1f(u.worldSpan,f.bottom-f.top);
     gl.uniform2f(u.metric,2*Math.PI*6371,(f.bottom-f.top)*6371);
     return {p,u};
   });
   const make=(w,h,format=gl.RGBA16F,repeat=false)=>{
     const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
     gl.texStorage2D(gl.TEXTURE_2D,1,format,w,h);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
     for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
     return tex;
   };
   const target=(format)=>{const texture=make(this.width,this.height,format,true),fb=gl.createFramebuffer();
     gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
     if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete world field');
     return {texture,fb};};
   this.field=make(f.width,f.height,gl.RGBA16F,true);this.previousField=make(f.width,f.height,gl.RGBA16F,true);this.wind=make(f.width,f.height,gl.RGBA16F,true);
   this.a=target(gl.RG16F);this.b=target(gl.RG16F);this.predicted=target(gl.RG16F);this.forces=target(gl.RGBA16F);this.deviations=target(gl.R16F);
   this.fieldData=new Float32Array(f.n*4);this.windData=new Float32Array(f.n*4);
   this.noise=make(256,256,gl.R8,true);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
   const rng=random(f.seed^0x691c99);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,256,gl.RED,gl.UNSIGNED_BYTE,Uint8Array.from({length:65536},()=>rng()*256));
   const atlas=target(gl.R16F);
   this.texture(3,this.noise); this.use(4); gl.viewport(0,0,this.width,this.height); this.draw();
   gl.deleteFramebuffer(atlas.fb); gl.deleteTexture(this.noise); this.noise=atlas.texture;
   this.columns=make(160,160,gl.R16F);this.palette=make(1024,1,gl.RGBA8);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 }
 texture(i,t){const g=this.gl;g.activeTexture(g.TEXTURE0+i);g.bindTexture(g.TEXTURE_2D,t);}
 use(i){const {p,u}=this.programs[i];this.gl.useProgram(p);this.gl.uniform4f(u.box,0,0,1,1);return u;}
 draw(){this.gl.drawArrays(this.gl.TRIANGLES,0,3);}
 update(f,systems,meshes){
   this.seasonDay=f.seasonDay;
   const g=this.gl,time=f.time,init=this.time===null,dt=init?0:time-this.time;
   if(g.isContextLost())throw Error('Global observation context lost');
   if(!init && dt<=0 && this.injection===f.injectionRevision && this.env===f.envRevision)return;
   const b=this.fieldData,m=this.windData,e=f.envFields;
   for(let i=0,k=0;i<f.n;i++,k+=4){
     b[k]=f.water[i];b[k+1]=f.convection[i];b[k+2]=f.temperature[i];b[k+3]=f.land[i]?f.soilHeat[i]:e.sst[i]-f.seaCooling[i];
     m[k]=f.u[i]+e.upperU[i];m[k+1]=f.v[i]+e.upperV[i];m[k+2]=f.vapor[i]/(3.8*Math.exp(.059*f.temperature[i]));m[k+3]=e.convectiveActivity[i];
   }
   [this.field,this.previousField]=[this.previousField,this.field];this.texture(6,this.previousField);
   this.texture(0,this.field);g.texSubImage2D(g.TEXTURE_2D,0,0,0,f.width,f.height,g.RGBA,g.FLOAT,b);
   this.texture(1,this.wind);g.texSubImage2D(g.TEXTURE_2D,0,0,0,f.width,f.height,g.RGBA,g.FLOAT,m);
   this.texture(3,this.noise);this.texture(4,null);g.viewport(0,0,this.width,this.height);
   this.texture(9,null);g.bindFramebuffer(g.FRAMEBUFFER,this.deviations.fb);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);
   g.bindFramebuffer(g.FRAMEBUFFER,this.forces.fb);g.clear(g.COLOR_BUFFER_BIT);
   g.enable(g.BLEND);g.enable(g.SCISSOR_TEST);g.blendFunc(g.ONE,g.ONE);
   const v=this.use(1);
   this.texture(7,this.columns);
   for(const s of systems){
     if(s.kind==='cloud'||s.kind==='anticyclone'||s.wind<7)continue;
     const pt=f.point(s.lon,s.lat),x=((pt.x+.5)/f.width+1)%1,y=(pt.y+.5)/f.height,cs=Math.max(.09,Math.cos(s.lat*Math.PI/180));
     const nest=meshes?.get(s.id);
     const rm=radiusOfMaximumWind(s),r=Math.max(2.5*rm,Math.min(s.radius*1.45,nest?950:5*rm)),rx=r/(40030*cs),ry=r/((f.bottom-f.top)*6371*cs);
     if(nest){
       const x0=f.point(nest.bounds.west,nest.bounds.north),spanX=(nest.bounds.east-nest.bounds.west)/360,spanY=(nest.bottom-nest.top)/(f.bottom-f.top);
       g.uniform4f(v.footprint,(x0.x+.5)/f.width+spanX*.5,(x0.y+.5)/f.height+spanY*.5,spanX,spanY);
       g.texSubImage2D(g.TEXTURE_2D,0,0,0,nest.width,nest.height,g.RED,g.FLOAT,nest.water);
     }else g.uniform4f(v.footprint,0,0,0,0);
     g.uniform4f(v.host,x,y,r,rm);g.uniform4f(v.state,s.wind*3.6,Math.sign(s.lat)||1,s.organization||0,s.eye||0);
     for(const shift of [0,...(x<rx?[1]:x>1-rx?[-1]:[])]){
       // The full-screen triangle would extend beyond a subrect; contributions
       // are exactly zero outside the physical radius in the fragment shader.
       const left=Math.floor((x-rx+shift)*this.width),bottom=Math.floor((y-ry)*this.height);
       g.scissor(left,bottom,Math.ceil((x+rx+shift)*this.width)-left,Math.ceil((y+ry)*this.height)-bottom);
       g.uniform4f(v.box,x-rx+shift,y-ry,2*rx,2*ry);
       g.bindFramebuffer(g.FRAMEBUFFER,this.forces.fb);g.uniform1i(v.deviations,0);this.draw();
       if(nest){g.bindFramebuffer(g.FRAMEBUFFER,this.deviations.fb);g.uniform1i(v.deviations,1);this.draw();}
     }
   }
   g.disable(g.BLEND);g.disable(g.SCISSOR_TEST);this.texture(4,this.forces.texture);
   const steps=Math.max(1,Math.ceil(dt/.5));
   for(let k=0;k<steps;k++){
     this.texture(2,this.a.texture);this.texture(8,null);g.bindFramebuffer(g.FRAMEBUFFER,this.predicted.fb);
     g.uniform1f(this.use(3).dt,dt/steps);this.draw();
     g.bindFramebuffer(g.FRAMEBUFFER,this.b.fb);this.texture(8,this.predicted.texture);
     const u=this.use(0);
     g.uniform1f(u.dt,dt/steps);g.uniform1f(u.clock,time-dt+(k+1)*dt/steps);
     g.uniform1f(u.first,init?1:0);this.draw();[this.a,this.b]=[this.b,this.a];
   }
   this.time=time;this.injection=f.injectionRevision;this.env=f.envRevision;
 }
 image(layer){
   const g=this.gl,u=this.use(2);g.bindFramebuffer(g.FRAMEBUFFER,null);g.viewport(0,0,this.width,this.height);
   this.texture(0,this.field);this.texture(2,this.a.texture);this.texture(9,this.deviations.texture);
   this.texture(5,this.palette); // texSubImage2D below writes to the active unit.
   if(layer==='day-night'){
     const sun=solarPosition(this.time,this.seasonDay);
     g.uniform3f(u.solar,sun.lon,sun.sinDecl,sun.cosDecl);
   }else if(layer!=='cloud'&&this.paletteLayer!==layer){
     const rgba=new Uint8Array(4096);
     for(let i=0;i<1024;i++)rgba.set(scaleRGBA(layer,layer==='convection'?i/1023:-100+160*i/1023),4*i);
     g.texSubImage2D(g.TEXTURE_2D,0,0,0,1024,1,g.RGBA,g.UNSIGNED_BYTE,rgba);this.paletteLayer=layer;
   }
   g.uniform1i(u.product,layer==='day-night'?4:layer==='cloud'?0:layer==='convection'?1:layer==='infrared'?2:3);this.draw();
   return this.canvas.transferToImageBitmap();
 }
}
