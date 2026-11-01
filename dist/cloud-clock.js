export const CLOUD_STEP_HOURS = .5;
// Numerical steps and the 24 Hz CLOUD DISPLAY are different clocks. A 24h/s
// request needs 48 half-hour solves/s, not a 24Hz numerical dispatch limit.
// Single-flight back-pressure still bounds work; leave 8% scheduling headroom
// rather than forcing every completed step to idle for twice its compute time.
export const cloudDispatchInterval = (workMs, rate = 1) =>
  Math.max(CLOUD_STEP_HOURS * 1000 / Math.max(1, rate), Math.max(0, workMs || 0) * 1.08);

export class SimulationClock {
  constructor() { this.debt = 0; this.measuredHours = 0; this.measuredSeconds = 0; this.actualRate = 0; }
  advance(seconds, rate, running, hours, completedHours) {
    if (!running) { this.debt = 0; this.measuredHours = 0; this.measuredSeconds = 0; this.actualRate = 0; return 0; }
    // Keep blocked time, but never queue minutes of catch-up after a stall.
    // One in-flight tick + one queued tick bounds both latency and memory.
    this.debt = Math.min(CLOUD_STEP_HOURS * 2, this.debt + Math.max(0, seconds) * rate);
    const available = Math.max(0, Math.max(0, completedHours) + CLOUD_STEP_HOURS - hours);
    const advance = Math.min(this.debt, available);
    this.debt -= advance;
    this.measuredHours += advance; this.measuredSeconds += Math.max(0, seconds);
    if (this.measuredSeconds >= 1) {
      this.actualRate = this.measuredHours / this.measuredSeconds;
      this.measuredHours = 0; this.measuredSeconds = 0;
    }
    return advance;
  }
}

// A completed atmosphere changes on solver ticks, not every display frame.
// Insertions/removals, layer switches and environment edits still publish at once.
export function cloudSolutionKey(sim, layer) {
  const tick = Math.floor((Math.max(0, sim.hours) + 1e-8) / CLOUD_STEP_HOURS);
  return `${tick}:${sim.systems.map(s => s.id).join(',')}:${sim.env.revision}:${layer}`;
}
