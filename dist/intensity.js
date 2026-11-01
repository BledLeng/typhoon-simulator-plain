const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Environmental readiness for faster intensification, not a random RI switch.
 * Timescales are educational tuning, not a fitted SHIPS-RII forecast model.
 * The thermal capacity and all existing adverse-environment gates remain active.
 */
export function evolveIntensification(s, e, { support, convection, humidity, landFraction }, dt) {
  const tropical = s.kind === 'disturbance' && !s.absorbedBy;
  const target = tropical ? smooth(.3, .75, support) * smooth(.4, .8, s.organization)
    * smooth(.35, .85, convection) * smooth(35, 110, e.ohc)
    * smooth(60, 85, humidity) * (1 - smooth(5, 15, e.shear))
    * (1 - clamp(s.dryIntrusion || 0, 0, 1)) * (1 - clamp(s.terrainExposure || 0, 0, 1))
    * (1 - clamp(landFraction, 0, 1)) * (1 - clamp(s.transition || 0, 0, 1)) : 0;
  const old = s.intensificationReadiness || 0;
  s.intensificationReadiness = old + (target - old) * (1 - Math.exp(-dt / (target > old ? 4 : 2)));
  const active = Math.min(target, s.intensificationReadiness);
  return { windHours: tropical ? 30 - 16 * active : 40, organizationHours: 30 - 14 * active };
}
const specificHumidity = (temperature, pressure) => {
  const vapourPressure = 6.112 * Math.exp(17.67 * temperature / (temperature + 243.5));
  return .622 * vapourPressure / (pressure - .378 * vapourPressure);
};

/** Reduced-order heat-engine capacity, m/s at the surface, not full Emanuel PI.
 * A sounding/CAPE solver is not available in this single-layer simulation.
 * Boundary-layer RH, outflow T and Ck/Cd are therefore explicit approximations.
 * Reference: Gilford 2021, doi:10.5194/gmd-14-2351-2021.
 * No universal wind-speed cap: changing thermal state changes the capacity.
 */
export function thermalWindCapacity(e, latitude = 15) {
  const sea = clamp(e.sst, -2, 40), pressure = clamp(e.pressure ?? 1010, 800, 1100);
  const air = clamp(e.surfaceAirTemperature ?? sea - 2, sea - 6, sea + 2);
  const surfaceRH = clamp(e.surfaceHumidity ?? (.78 + ((e.humidity ?? 70) - 70) * .001), .6, .98);
  const outflow = clamp(e.outflowTemperature ?? (200 + 12 * Math.min(1, Math.max(0, (Math.abs(latitude) - 25) / 40))), 175, 245);
  const enthalpy = Math.max(0, 1005 * (sea - air) + 2.5e6 *
    (specificHumidity(sea, pressure) * .98 - surfaceRH * specificHumidity(air, pressure)));
  const efficiency = Math.max(0, (sea + 273.15 - outflow) / outflow);
  const exchangeRatio = clamp(e.exchangeRatio ?? 1, .4, 1.5);
  return .9 * Math.sqrt(exchangeRatio * efficiency * enthalpy);
}
