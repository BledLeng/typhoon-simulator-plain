// Equivalent scalar thermodynamic kernel. No fast-math, reduced grid, skipped
// cells or altered time step. Float32 state / Float64 coefficients match JS.
#include "../physics/marine.generated.h"
__attribute__((import_module("math"), import_name("exp"))) double exp(double);
#define F(k,i) ((double)((float *)(unsigned long)a[k])[i])
#define D(k,i) (((double *)(unsigned long)a[k])[i])
#define OUT(k,i,v) (((float *)(unsigned long)a[k])[i]=(float)(v))
enum { Q,C,T,P,U,V,LAND,SEA,SOILT,SOILQ,INFLOW,CORE,LIFT,SINK,DRYMIX,DRYQ,CONV,
 UUP,VUP,SST,THERMH,ACTLIFT,FRONT,ACTSECTOR,AMBILIFT,AMBIT,SATSURF,TARGETQ,
 TRANSPORT,KMX,KMY,Q1,C1,T1,P1,CONV1 };
static double min(double a,double b){return a<b?a:b;}
static double max(double a,double b){return a>b?a:b;}
static double clamp(double v,double a,double b){return max(a,min(b,v));}
static double smooth(double a,double b,double v){double t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);}
// Avoid two WASM -> JS exp calls per cell. Within the solver's temperature
// range the residual is < .001844; the fifth-order remainder is < 6e-20.
// Outside the table use the reference formula, never a clamped temperature.
static double sat_base[3073];
static double sat(double t){
  double pos=(t+48)*32;
  if(!(pos>=0 && pos<3072))return 3.8*exp(.059*t);
  unsigned k=(unsigned)pos;
  double x=(pos-k)*(.059/32);
  return sat_base[k]*(1+x*(1+x*(.5+x*(1./6+x*(1./24+x/120)))));
}

static inline double cloud_x(double x,unsigned w,int periodic) {
  return periodic ? (x<0||x>=w ? x-__builtin_floor(x/w)*w : x) : clamp(x,0,w-1.001);
}

void step(unsigned w,unsigned h,int periodic,int transported,double dt,unsigned *a) {
  if(!sat_base[0])for(unsigned k=0;k<=3072;k++)sat_base[k]=3.8*exp(.059*(k/32.-48));
  const double convectionResponse=1-exp(-dt/1.5),relaxT=1-exp(-dt/24),relaxQ=1-exp(-dt/18);
  const double condenseRate=1-exp(-dt*3),rainRate=1-exp(-dt/4),coldRate=1-exp(-dt/8);
  // Predict into the dedicated transport buffer. Two as-yet unwritten output
  // channels store donor limits until their own cell is consumed below.
  if(transported==2)for(unsigned y=0;y<h;y++)for(unsigned x=0;x<w;x++){
    unsigned i=y*w+x;
    double bx=cloud_x(x-(F(U,i)+F(UUP,i))*dt/F(KMX,y),w,periodic);
    double by=clamp(y+(F(V,i)+F(VUP,i))*dt/F(KMY,y),0,h-1.001);
    unsigned ix=(unsigned)bx,iy=(unsigned)by,j=iy*w+ix,jr=ix==w-1?iy*w:j+1;
    double ax=bx-ix,ay=by-iy, p=F(C,j),q=F(C,jr),r=F(C,j+w),s=F(C,jr+w);
    OUT(TRANSPORT,i,(p*(1-ax)+q*ax)*(1-ay)+(r*(1-ax)+s*ax)*ay);
    OUT(Q1,i,min(min(p,q),min(r,s)));OUT(P1,i,max(max(p,q),max(r,s)));
  }
  for(unsigned y=0;y<h;y++) {
    const double kmx=F(KMX,y),kmy=F(KMY,y);
    const double mixX=min(.12,18*dt/(kmx*kmx)),mixY=min(.12,18*dt/(kmy*kmy));
    const unsigned aboveRow=(y?y-1:0)*w,belowRow=(y+1<h?y+1:h-1)*w;
    for(unsigned x=0;x<w;x++) {
      const unsigned i=y*w+x,left=x?i-1:(periodic?i+w-1:i),right=x+1<w?i+1:(periodic?i-w+1:i);
      const unsigned above=aboveRow+x,below=belowRow+x;
      const double rawX=x-F(U,i)*dt/kmx;
      const double bx=periodic?(rawX<0||rawX>=w?rawX-__builtin_floor(rawX/w)*w:rawX):clamp(rawX,0,w-1.001);
      const double by=clamp(y+F(V,i)*dt/kmy,0,h-1.001);
      const unsigned ix=(unsigned)__builtin_floor(bx),iy=(unsigned)__builtin_floor(by),j=iy*w+ix;
      const double ax=bx-ix,ay=by-iy,aa=(1-ax)*(1-ay),ab=ax*(1-ay),ba=(1-ax)*ay,bb=ax*ay;
      const unsigned jr=ix==w-1?iy*w:j+1;
      double q=F(Q,j)*aa+F(Q,jr)*ab+F(Q,j+w)*ba+F(Q,jr+w)*bb;
      double t=F(T,j)*aa+F(T,jr)*ab+F(T,j+w)*ba+F(T,jr+w)*bb;
      double cold=F(P,j)*aa+F(P,jr)*ab+F(P,j+w)*ba+F(P,jr+w)*bb;
      double c;
      if(transported==2){
        double xx=cloud_x(x+(F(U,i)+F(UUP,i))*dt/kmx,w,periodic);
        double yy=clamp(y-(F(V,i)+F(VUP,i))*dt/kmy,0,h-1.001);
        unsigned cx=(unsigned)xx,cy=(unsigned)yy, k=cy*w+cx,r=cx==w-1?cy*w:k+1;
        double a0=xx-cx,b0=yy-cy;
        double reverse=(F(TRANSPORT,k)*(1-a0)+F(TRANSPORT,r)*a0)*(1-b0)
                    +(F(TRANSPORT,k+w)*(1-a0)+F(TRANSPORT,r+w)*a0)*b0;
        c=(float)clamp(F(TRANSPORT,i)+.5*(F(C,i)-reverse),F(Q1,i),F(P1,i));
      } else if(transported)c=F(TRANSPORT,i);
      else {
        double cx=bx-F(UUP,i)*dt/kmx;
        if(periodic){if(cx<0||cx>=w)cx-=__builtin_floor(cx/w)*w;}else cx=clamp(cx,0,w-1.001);
        const double cy=clamp(by+F(VUP,i)*dt/kmy,0,h-1.001);
        const unsigned x0=(unsigned)__builtin_floor(cx),y0=(unsigned)__builtin_floor(cy),j0=y0*w+x0;
        const unsigned j1=x0==w-1?y0*w:j0+1;
        const double a0=cx-x0,b0=cy-y0;
        c=(F(C,j0)*(1-a0)+F(C,j1)*a0)*(1-b0)+(F(C,j0+w)*(1-a0)+F(C,j1+w)*a0)*b0;
      }
      c=c*(1-2*mixX-2*mixY)+mixX*(F(C,left)+F(C,right))+mixY*(F(C,above)+F(C,below));
      const double divergence=(F(U,right)-F(U,left))/(2*kmx)-(F(V,below)-F(V,above))/(2*kmy);
      const int ocean=F(LAND,i)==0;
      const double surfaceT=ocean?F(SST,i)-F(SEA,i):F(SOILT,i);
      const double wet=ocean?1:smooth(.35,.85,F(SOILQ,i));
      const double rh=q/sat(t);
      const double thermal=wet*smooth(19,29,surfaceT)*smooth(.5,3,surfaceT-t)*smooth(.55,.95,rh)*D(THERMH,i)*D(ACTLIFT,i);
      const double frontal=F(FRONT,i)*smooth(.6,.95,rh)*.1;
      const double radiative=smooth(.65,1,rh)*(.035+.045*smooth(0,.6,c));
      double resolved=-divergence*2;
      if(F(INFLOW,i)>0){
        const double support=F(CORE,i);
        const double response=smooth(.62,1,rh)*(support+(1-support)*D(ACTSECTOR,i))/(1+cold*.7*(1-support*.8));
        resolved-=F(INFLOW,i)*(1-response);
      }
      const double uplift=clamp(resolved+F(LIFT,i)+thermal+frontal+D(AMBILIFT,i),-.3,1);
      t+=(F(AMBIT,i)-t)*relaxT-(uplift*3.6+radiative)*dt+F(SINK,i)*dt*.8;
      const double saturation=sat(t);
      const double surfaceSat=ocean&&F(SEA,i)==0?D(SATSURF,i):sat(surfaceT);
      const double wind=__builtin_sqrt(F(U,i)*F(U,i)+F(V,i)*F(V,i));
      const double evaporation=flaq_vaporSupply(surfaceSat,q,wind,wet,ocean)*dt;
      const double imported=(F(TARGETQ,i)-q)*relaxQ;
      q+=imported*(imported>0?1-clamp(F(LIFT,i)*2+F(SINK,i)*5,0,.85):1)+evaporation;
      if(F(DRYMIX,i)>0)q+=(min(q,F(DRYQ,i)/F(DRYMIX,i))-q)*(1-exp(-F(DRYMIX,i)*dt));
      if(F(SINK,i)>0)q+=(min(q,saturation*.6)-q)*(1-exp(-F(SINK,i)*dt*2));
      const double resolvedCloud=max(0,q-saturation);
      const double target=ocean?flaq_marineTarget(q,c,saturation,D(ACTSECTOR,i),F(SINK,i)):0;
      const double condensed=flaq_condensation(q,resolvedCloud,c,target,condenseRate);
      const double conv=F(CONV,j)*aa+F(CONV,jr)*ab+F(CONV,j+w)*ba+F(CONV,jr+w)*bb;
      OUT(CONV1,i,conv+(max(0,uplift)*resolvedCloud*condenseRate/dt-conv)*convectionResponse);
      q-=condensed;c+=condensed;t+=condensed*1.8;
      const double evaporated=flaq_reevaporation(c,q,saturation,target,F(SINK,i),dt);
      c-=evaporated;q+=evaporated;t-=evaporated*1.8;
      const double rain=max(0,c-.3)*rainRate;c-=rain;
      if(!ocean){
        OUT(SOILQ,i,clamp(F(SOILQ,i)+rain*.045-evaporation*.012-dt*.0015,0,1));
        OUT(SOILT,i,F(SOILT,i)+(F(AMBIT,i)-F(SOILT,i))*relaxT-evaporation*.12);
      }
      cold+=rain*.8+evaporated*.5-cold*coldRate;
      OUT(Q1,i,clamp(q,0,40));OUT(C1,i,clamp(c,0,8));OUT(T1,i,clamp(t,-25,40));OUT(P1,i,clamp(cold,0,8));
    }
  }
}
