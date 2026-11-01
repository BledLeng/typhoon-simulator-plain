// Knaff & Zehr (2007), equations 4–7; winds in knots, distances in km.
// The size diagnostic uses OUR radial profile, not observed 500-km winds.
// This is a reduced-order estimate, not an operational pressure analysis.
import { flaq_deficit } from './pressure.generated.js';
export function tropicalPressureDeficit(s, rmw) {
  return flaq_deficit(s.wind,s.lat ?? 15,s.windFieldU ?? s.u ?? 0,s.windFieldV ?? s.v ?? 0,
    s.radius ?? 320,rmw,s.transition ?? (s.kind === 'extratropical' ? 1 : 0));
}
