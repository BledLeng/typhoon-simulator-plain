// Synthetic shallow/deep layer steering, inspired by the layer-depth principle
// used in BAM models. These coefficients are not operational pressure levels or
// a calibrated forecast. No per-storm random heading or saved trajectory.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function steeringDepth(s) {
  if (s.kind === 'cloud' || s.kind === 'anticyclone') return 0;
  const coherence = Math.sqrt(clamp(s.organization || 0, 0, 1) * clamp(s.warmCore || 0, 0, 1));
  const tropical = smooth(12, 55, s.wind) * (.35 + .65 * coherence);
  const transition = clamp(s.transition ?? Number(s.kind === 'extratropical'), 0, 1);
  return tropical + (.75 - tropical) * transition;
}

export function steeringFlow(s, e, depth = steeringDepth(s)) {
  return {
    u: e.u + ((e.deepU ?? e.u) - e.u) * depth,
    v: e.v + ((e.deepV ?? e.v) - e.v) * depth,
  };
}
