// User-facing environmental controls. Model coefficients remain educational,
// not a calibrated forecast. Event duration is in simulated hours.
export const ENV_CONTROLS = [
  { key: 'backgroundPressure', label: '背景气压', min: 1000, max: 1025, step: 1, unit: 'hPa', group: '基础' },
  { key: 'seaTemperature', label: '热带海温', min: 22, max: 32, step: .5, unit: '°C', group: '基础' },
  { key: 'humidity', label: '环境湿度', min: 30, max: 98, step: 2, unit: '%', group: '基础' },
  { key: 'shear', label: '背景风切变', min: 0, max: 40, step: 1, unit: 'm/s', group: '基础' },
  { key: 'mixedLayer', label: '暖水层深度', min: 15, max: 160, step: 5, unit: 'm', group: '基础' },
  { key: 'genesisMultiplier', label: '气旋生成概率倍率', min: .25, max: 4, step: .25, unit: '×', group: '基础' },
  { key: 'seasonDay', label: '季节（年内日）', min: 1, max: 365, step: 1, unit: '日', group: '基础' },
  { key: 'upperCold', label: '高空冷涡强度', min: 0, max: 3, step: .1, unit: '×', group: '环流' },
  { key: 'monsoon', label: '季风槽强度', min: 0, max: 20, step: 1, unit: 'km/h', group: '环流' },
  { key: 'ridgePressure', label: '副高背景气压', min: 1010, max: 1035, step: 1, unit: 'hPa', group: '环流' },
  { key: 'ridgeLongitude', label: '副高背景经度', min: 115, max: 180, step: 1, unit: '°E', group: '环流' },
  { key: 'ridgeLatitude', label: '副高背景纬度', min: 20, max: 42, step: 1, unit: '°N', group: '环流' },
  { key: 'ridgeMobility', label: '副高自动变化', min: 0, max: 2, step: .1, unit: '×', group: '环流' },
  { key: 'polarStrength', label: '极地涡旋强度', min: 0, max: 2, step: .1, unit: '×', group: '环流' },
  { key: 'polarDisplacement', label: '极涡偏移幅度', min: 0, max: 2, step: .1, unit: '×', group: '环流' },
  { key: 'enso', label: 'ENSO 指数', min: -2, max: 2, step: .25, unit: '°C', group: '环流' },
];
export const ENV_EVENTS = Object.freeze({ cold: '冷空气侵入', shear: '强切变脉冲', moist: '水汽输送增强', monsoon: '季风活跃期' });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = v => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
export function setEnvironmentValue(env, key, value) {
  const spec = ENV_CONTROLS.find(s => s.key === key);
  if (!spec || !Number.isFinite(Number(value))) return false;
  env[key] = clamp(Math.round(Number(value) / spec.step) * spec.step, spec.min, spec.max);
  env.revision = (env.revision || 0) + 1;
  return true;
}
export function startEnvironmentEvent(env, type, hours, options = {}) {
  if (!ENV_EVENTS[type]) return false;
  const { intensity = 1, duration = 48, lon = 135, lat = 18 } = options;
  if (![hours, intensity, duration, lon, lat].every(Number.isFinite)) return false;
  env.events = (env.events || []).filter(e => hours < e.start + e.duration);
  if (env.events.length >= 6) return false;
  env.events.push({ type, start: hours, duration: clamp(duration, 12, 120), intensity: clamp(intensity, .25, 2), lon, lat });
  env.revision = (env.revision || 0) + 1;
  return true;
}
export function environmentEventEffects(env, lon, lat, hours) {
  const result = { cold: 0, shear: 0, moist: 0, monsoon: 0 };
  for (const event of env.events || []) {
    const age = hours - event.start;
    if (age < 0 || age >= event.duration || !(event.type in result)) continue;
    const ramp = Math.min(6, event.duration / 4);
    const envelope = smooth(age / ramp) * smooth((event.duration - age) / ramp);
    const delta = ((lon - event.lon + 540) % 360 + 360) % 360 - 180;
    const dx = delta * Math.cos(lat * Math.PI / 180) * 111.2, dy = (lat - event.lat) * 111.2;
    result[event.type] += envelope * event.intensity * Math.exp(-(dx * dx + dy * dy) / 1800 ** 2);
  }
  return result;
}
