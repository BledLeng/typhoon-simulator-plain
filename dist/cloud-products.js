// Diagnostic products share one simulated atmosphere, not observed satellite data.
import { isInfrared, scaleRGBA } from './satellite-scales.js?v=global-39';
import {solarPosition,daylight} from './day-night.js?v=global-39';
export const isCloudProduct = layer => layer === 'cloud' || layer === 'day-night' || layer === 'convection' || isInfrared(layer);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Planck radiance at 10.3 µm. The wavelength-dependent prefactor cancels in
// the mixture/inverse. Thin cloud transmits part of the warm surface radiance.
const C2_OVER_WAVELENGTH = 14387.76877 / 10.3;
const radiance = celsius => 1 / Math.expm1(C2_OVER_WAVELENGTH / (celsius + 273.15));
const radianceTable = Float64Array.from({length:1601}, (_, i) => radiance(-100 + i / 10));
const radianceSample = temperature => {
  const x = clamp((temperature + 100) * 10, 0, 1599.999), i = Math.floor(x);
  return radianceTable[i] + (radianceTable[i + 1] - radianceTable[i]) * (x - i);
};
const maxRadiance = radiance(60);
// Each enhancement is compiled once on first use, outside the pixel loop.
const tables = new Map();
function displayTable(layer) {
  if (tables.has(layer)) return tables.get(layer);
  const conv = layer === 'convection', count = conv ? 1025 : 16384;
  const table = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const value = conv ? i / (count - 1) : i === 0 ? -100
      : C2_OVER_WAVELENGTH / Math.log1p((count-1) / (i * maxRadiance)) - 273.15;
    table.set(scaleRGBA(layer,value), i*4);
  }
  tables.set(layer,table);
  return table;
}
export function brightnessTemperature(surface, cloudTop, emissivity) {
  const e = clamp(emissivity, 0, 1);
  const mixed = radiance(surface) * (1 - e) + radiance(cloudTop) * e;
  return C2_OVER_WAVELENGTH / Math.log1p(1 / mixed) - 273.15;
}

// Local condensation memory is a rate, not wind or cloud cover. Response at
// modest rates matters: broad anvils and narrow active towers need not match.
const activityOf = c => c > 0 ? c / (c + .045) : 0;
const topOf = (water, activity, tropopause, temperature, surface) =>
  Math.max(-90, Math.min(surface,temperature - 6.2 * Math.min(tropopause,
    1.2 + 3 * water / (water + .6) + activity * (tropopause - 3))));
const emissivityOf = water => -Math.expm1(-water * 2.8);
const surfaceOf = (field,i) => field.land[i] ? field.soilHeat[i] : field.envFields.sst[i] - field.seaCooling[i];
export function cloudDiagnostic(field,i,tropopauseKm) {
  const water = Math.max(0,field.water[i]), activity = activityOf(field.convection[i]), surface = surfaceOf(field,i);
  return {activity,surface,top:topOf(water,activity,tropopauseKm,field.temperature[i],surface),emissivity:emissivityOf(water)};
}
export function cloudProductPixels(field,layer) {
  if(layer==='day-night')return dayNightPixels(field);
  const pixels = new Uint8ClampedArray(field.n*4), conv = layer === 'convection';
  const colors = displayTable(layer), overlay = layer === 'infrared';
  for (let y=0;y<field.height;y++) {
    const tropopause = 17 - 6 * Math.abs(Math.sin(field.lat[y] * Math.PI / 180));
    for (let x=0;x<field.width;x++) {
      const i=y*field.width+x, k=i*4, water=Math.max(0,field.water[i]);
      const activity=activityOf(field.convection[i]), e=emissivityOf(water);
      let color;
      if (conv) {
        // No ascent: neutral cloud. Thin/dry columns cannot masquerade as
        // deep convection simply because a convective parcel passed through.
        color = Math.round(activity*e*1024)*4;
        pixels[k+3] = 255*e*(.35+.65*activity);
      } else {
        const surface=surfaceOf(field,i), top=topOf(water,activity,tropopause,field.temperature[i],surface);
        const mixed=radianceSample(surface)*(1-e)+radianceSample(top)*e;
        color=Math.round(clamp(mixed/maxRadiance,0,1)*16383)*4;
        pixels[k+3]=overlay ? e*colors[color+3] : 255;
      }
      pixels[k]=colors[color]; pixels[k+1]=colors[color+1]; pixels[k+2]=colors[color+2];
    }
  }
  return pixels;
}

// CPU fallback. Day is the existing visible-cloud observation; night uses
// 10.3 µm radiance and cloud emissivity, NOT the visible image dyed blue.
// Mix premultiplied endpoints so clear-day alpha exposes the unmodified map.
function dayNightPixels(field){
  const {width,height}=field, pixels=field.pixels('cloud',1,field.water);
  const sun=solarPosition(field.time,field.seasonDay), bw=displayTable('ir-bw');
  const hourCos=Float64Array.from(field.lon,lon=>Math.cos(lon*Math.PI/180-sun.lon));
  for(let y=0;y<height;y++){
    const lat=field.lat[y]*Math.PI/180,s=Math.sin(lat),base=s*sun.sinDecl,amp=Math.cos(lat)*sun.cosDecl;
    const trop=17-6*Math.abs(s);
    for(let x=0,i=y*width;x<width;x++,i++){
      const d=daylight(base+amp*hourCos[x]);
      if(d===1)continue;
      const water=Math.max(0,field.water[i]), e=emissivityOf(water),surface=surfaceOf(field,i);
      const top=topOf(water,activityOf(field.convection[i]),trop,field.temperature[i],surface);
      const mixed=radianceSample(surface)*(1-e)+radianceSample(top)*e;
      const gray=bw[4*Math.round(clamp(mixed/maxRadiance,0,1)*16383)]/255;
      const cold=clamp(1.35*gray-.30,0,1), cloud=e*(.35+.65*cold), clear=.82*(1-cloud);
      const k=4*i,lit=d*pixels[k+3]/255,dark=1-d,alpha=lit+dark*(cloud+clear);
      pixels[k]=(pixels[k]*lit+dark*(cloud*(103+139*cold)+clear*6))/alpha;
      pixels[k+1]=(pixels[k+1]*lit+dark*(cloud*(120+126*cold)+clear*17))/alpha;
      pixels[k+2]=(pixels[k+2]*lit+dark*(cloud*(145+105*cold)+clear*32))/alpha;
      pixels[k+3]=alpha*255;
    }
  }
  return pixels;
}
