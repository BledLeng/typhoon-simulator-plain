// Display choices and initial-condition validation; no changes to the solver.
export const MAP_LAYERS = Object.freeze([
  ['cloud', '云水'], ['day-night', '昼夜'], ['convection', '对流云图'], ['ir-bw', '红外 · BW 灰阶'],
  ['ir-bd', '红外 · BD 分段增强'], ['ir-rbtop', '红外 · RBTOP 彩色增强'],
  ['ir-ott', '红外 · OTT 冷云增强'], ['infrared', '红外 · 冷云深红'],
  ['sst', '海温 12—32°C'], ['ohc', '热含量 0—140 kJ/cm²'], ['cooling', '冷尾迹降温 0—6°C'],
  ['shear', '风切变 0—40 m/s'], ['humidity', '湿度 25—100%'],
  ['temperature', '气温 0—35°C'], ['pressure', '气压（含气旋与高压）'],
]);
export const TIME_RATES = Object.freeze([1, 3, 6, 12, 24]);
export const nextTimeRate = rate => TIME_RATES[(TIME_RATES.indexOf(rate) + 1) % TIME_RATES.length];
export const INITIAL_RADIUS = Object.freeze({min:70, max:2600, step:10, default:300});
export const RANDOM_RADIUS = Object.freeze({min:70,max:800});
export function initialRadius(value) {
  const {min,max,step,default:fallback} = INITIAL_RADIUS;
  return Number.isFinite(value) ? Math.round(Math.max(min,Math.min(max,value))/step)*step : fallback;
}
// Quadratic travel gives small systems useful precision without restricting
// the upper end. This maps the value, not the Runtime spring/motion.
export const radiusFromPosition = position => initialRadius(INITIAL_RADIUS.min
  + (INITIAL_RADIUS.max - INITIAL_RADIUS.min) * Math.max(0,Math.min(1,position)) ** 2);
export const positionFromRadius = radius => Math.sqrt((initialRadius(radius)-INITIAL_RADIUS.min)
  / (INITIAL_RADIUS.max-INITIAL_RADIUS.min));
export function endpointTrackFill({position,centerFraction}) {
  const smooth = t => {t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  return centerFraction * smooth(position/.12)
    + (1-centerFraction) * smooth((position-.88)/.12);
}
export function spawnOptions(kind, radius, randomSize = null) {
  if (kind !== 'low' && kind !== 'disturbance' && kind !== 'subtropical') return {};
  // Sample once, on creation. Equal odds per size ratio keep giant systems uncommon.
  const {min, max} = RANDOM_RADIUS;
  const size = initialRadius(randomSize ? min * (max / min) ** randomSize() : radius);
  return {radius:size, birthRadius:size, customRadius:true, ...(kind === 'low' ? {forcedLow:true,wind:7.5,organization:.15} : {})};
}
