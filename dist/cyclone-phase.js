// Reduced-order phase evolution, not a 3-D cyclone phase-space diagnosis.
// NHC: a non-frontal hybrid cyclone has shallow warm-core convection and a
// broad, asymmetric wind maximum; wind speed alone does not make it tropical.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function subtropicalSupport(s, e) {
  return smooth(16, 24, e.sst) * smooth(2, 9, e.upperCold || 0)
    * smooth(45, 80, e.humidity) * (1 - smooth(14, 30, e.shear))
    * (1 - smooth(.3, .8, e.front || 0)) * (1 - (s.landFraction || 0))
    * smooth(5, 18, Math.abs(s.lat));
}

export function evolveSubtropicalTransition(s, e, dt) {
  if (!['disturbance', 'subtropical', 'extratropical'].includes(s.kind)) return false;
  const hybrid = subtropicalSupport(s, e);
  const convection = smooth(.08, .6, s.convection || 0);
  const tropical = e.sst > 26 && e.shear < 12 && e.humidity > 65
    && (e.front || 0) < .2 && s.warmCore > .18 && s.organization > .45 && convection > .5;
  const frontal = e.shear > 16 && (s.baroclinicity || 0) > .18
    && (e.front || 0) > .45 && e.sst < 26;
  let target = null;
  if (s.kind === 'subtropical') target = tropical ? 'disturbance' : frontal ? 'extratropical' : null;
  else if (hybrid > .2 && convection > .2 && !tropical && Math.abs(s.lat) < 55
    && (s.kind === 'extratropical' || (s.transition || 0) > .2)) target = 'subtropical';
  if (s.phaseTarget !== target) { s.phaseTarget = target; s.phaseHours = 0; }
  s.phaseHours = target ? (s.phaseHours || 0) + dt : 0;
  const changed = !!target && s.phaseHours >= (target === 'disturbance' ? 18 : 12);
  if (changed) {
    s.kind = target; s.phaseHours = 0; s.phaseTarget = null;
    // Non-frontal hybrid structure is not an extratropical-front fraction.
    s.transition = target === 'extratropical' ? Math.max(.85, s.transition || 0) : 0;
    s.transitionHours = 0;
  }
  const old = s.subtropicality ?? (s.kind === 'subtropical' ? 1 : 0);
  s.subtropicality = old + (Number(s.kind === 'subtropical') - old) * (1 - Math.exp(-dt / 12));
  return changed;
}

export function circulationCoreRadius(s, tropicalRadius) {
  const hybrid = s.subtropicality ?? (s.kind === 'subtropical' ? 1 : 0);
  // Broad cold-low subtype. Small hybrid lows remain possible; this is not
  // a universal 100 km lower bound or a category derived from peak wind.
  const broad = clamp((s.radius || 350) * .38, 45, 200);
  return tropicalRadius + (broad - tropicalRadius) * hybrid;
}
