// Banding is organisation of the inner rainband, not optical clearing of the eye.
// These are reduced-order tendencies. The moisture solver decides where cloud forms.
const ramp = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function evolveBanding(s, support, convection, shear, humidity, dt) {
  const old = s.eyeBand || 0;
  if (!old && (s.kind !== 'disturbance' || s.wind <= 28)) return;
  // A covered, nearly axisymmetric core can instead clear from the centre.
  // Do not send every favourable vortex through the banding-eye pathway.
  const bandSupport = .22 + .6 * (1 - ramp(.48, .84, s.coreSymmetry ?? .55)) + .18 * ramp(2, 8, shear);
  const target = s.kind !== 'disturbance' || s.absorbedBy ? 0 :
    ramp(28, 44, s.wind) * ramp(.35, .75, s.organization) * ramp(.16, .50, s.warmCore)
    * ramp(.22, .55, support) * ramp(.32, .70, convection) * ramp(56, 79, humidity)
    * (1 - ramp(10, 22, shear)) * (1 - ramp(.18, .65, s.dryIntrusion || 0))
    * (1 - ramp(.25, .78, s.eye)) * (1 - (s.transition || 0)) * bandSupport;
  s.eyeBand = old + (target - old) * -Math.expm1(-dt / (target > old ? 6 : 4));
  if (s.eyeBand < .001 && !target) s.eyeBand = 0;
}

// Signed angular convergence anomaly; changes sign around a given radius.
// Each radius lags the inner band in the local direction of circulation.
export function bandAnomaly(q, ux, uy, angle, spin, amplitude) {
  if (!(amplitude > .01 && q > .38 && q < 2.7)) return 0;
  const a = angle - spin * 4.4 * Math.log(q);
  const alignment = ux * Math.cos(a) + uy * Math.sin(a);
  return amplitude * ramp(.38, .72, q) * (1 - ramp(1.75, 2.7, q)) * alignment;
}

export function eyeStructure(s) {
  if (s.kind !== 'disturbance') return null;
  const phase = s.eyewallCycle?.phase;
  if (phase === 'merging') return 'fusion';
  if (phase === 'contracting' || phase === 'forming') return 'double';
  if (s.eyeBand >= .35) return 'banding';
  return null;
}

const labels = {
  zh: { banding: '云卷眼', double: '双眼墙发展中', fusion: '眼墙融合置换中' },
  en: { banding: 'Banding eye', double: 'Secondary eyewall developing', fusion: 'Eyewall merger in progress' },
};

export function eyeStructureDetails(s, lang = 'zh') {
  const lines = [], kind = eyeStructure(s);
  if (kind) lines.push(labels[lang][kind]);
  if (s.eyewallMergers) lines.push((lang === 'en' ? 'Completed eyewall mergers: ' : '已完成眼墙融合：') + s.eyewallMergers);
  return lines.length ? '\n' + lines.join(' · ') : '';
}
