// Diagnostic sea-level pressure, not another atmospheric solver. Each system's
// actual central pressure supplies a smooth anomaly over the ambient field.
// Strongest same-sign anomaly wins in overlap, preventing a pile of nearby
// lows from inventing a centre deeper than every modelled cyclone.
export function pressureRange(systems = []) {
  let minimum = 980, maximum = 1040;
  for (const s of systems) if (Number.isFinite(s.pressure)) {
    minimum = Math.min(minimum, Math.floor(s.pressure / 10) * 10);
    maximum = Math.max(maximum, Math.ceil(s.pressure / 10) * 10);
  }
  return [minimum, maximum];
}

export function pressureSurface(field) {
  if (field.pressureTime === field.time && field.pressureVersion === field.stateRevision) return field.surfacePressure;
  const ambient = field.envFields.pressure;
  const output = field.surfacePressure ||= new Float32Array(field.n);
  const low = field.pressureLow ||= new Float32Array(field.n);
  const high = field.pressureHigh ||= new Float32Array(field.n);
  low.fill(0); high.fill(0);
  for (const s of field.systems || []) {
    if (!Number.isFinite(s.pressure)) continue;
    const p = field.point(s.lon,s.lat);
    const anomaly = s.pressure - field.sample(ambient,p.x,p.y);
    const extent = Math.max(45,(s.radius || 300)*.55), extentSquared = extent*extent;
    field.forStorm(s,extent*4,(i,dx,dy,r) => {
      const t = Math.min(1,Math.max(0,r/extent-3));
      const taper = 1-t*t*(3-2*t);
      const value = anomaly*Math.exp(-r*r/(2*extentSquared))*taper;
      if (value<low[i]) low[i]=value;
      if (value>high[i]) high[i]=value;
    });
  }
  for(let i=0;i<field.n;i++) output[i]=ambient[i]+low[i]+high[i];
  field.pressureTime=field.time; field.pressureVersion=field.stateRevision;
  return output;
}
