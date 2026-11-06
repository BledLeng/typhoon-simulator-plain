import {say,t,stormText} from './i18n.js';
import { MoistAtmosphere, FIELD_BOUNDS } from './cloud-field.js?v=eye-low-44';
import { systemLabel, isHighLatitudeSystem, visibleSystem, toKnots, destination } from './simulation.js?v=eye-42';
import { circulationState, polarBoundary } from './circulation.js';
import { drawWrappedContour } from './wind-contour.js';
import { CloudPresentation } from './cloud-presentation.js?v=global-39';
import { cloudSolutionKey, cloudDispatchInterval } from './cloud-clock.js';
import { stormRingGeometry } from './wind-rings.js?v=eye-42';
import { isInfrared } from './satellite-scales.js?v=eye-low-44';
import { trackLabel } from './storm-identifiers.js';
import { CpuWorldObserver } from './world-cloud-reference.js?v=eye-low-44';
import {solarPosition,TerminatorLine} from './day-night.js?v=global-39';

export class CloudRenderer {
  constructor(invalidate, simulation, makeLandMask) {
    this.invalidate = invalidate; this.simulation = simulation; this.layer = 'cloud';
    this.pending = false; this.lastRequest = -Infinity; this.lastHours = -1; this.lastLayer = null;
    this.showWindRings = true; this.frameCount = 0;
    this.patches = [];
    this.presentation = new CloudPresentation();
    this.terminator=new TerminatorLine();
    const width = 640, height = 512;
    const land = makeLandMask(width, height, FIELD_BOUNDS);
    try {
      this.worker = new Worker(new URL('./cloud-worker.js?v=eye-low-44', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => this.accept(data);
      this.worker.onerror = event => this.fail(event.message);
      this.worker.postMessage({ type: 'init', seed: simulation.seed, width, height, land: land.buffer }, [land.buffer]);
    } catch {
      this.fallback = new MoistAtmosphere(simulation.seed, width, height, land);
      this.cpuSky=new CpuWorldObserver(this.fallback);
    }
  }
  fail(message) {
    this.pending = false; this.error = String(message); this.worker?.terminate(); this.worker = null;
    console.error('Numerical atmosphere stopped:', message); this.invalidate();
  }
  accept(data) {
    this.pending = false;
    if (data.error) { this.fail(data.error); return; }
    if (data.inspectionOnly) { this.inspection = data.inspection; this.invalidate(); return; }
    if(data.layer==='day-night'){
      const hours=data.fieldHours??data.hours,season=data.seasonDay??this.simulation.env.seasonDay;
      this.sunFrom=this.lastLayer==='day-night'&&season===this.sunSeason?this.displayedSunHours():hours;
      this.sunTo=hours;this.sunSeason=season;
    }
    this.presentation.accept(data, performance.now());
    this.lastHours = data.hours; this.lastLayer = data.layer; this.frameCount++; this.workerFrames = (this.workerFrames || 0) + 1;
    this.workMs = data.workMs || 0;
    this.workMeanMs = this.workMeanMs === undefined ? this.workMs : this.workMeanMs + (this.workMs - this.workMeanMs) / 48;
    this.fieldHours = data.fieldHours ?? data.hours;
    this.kernel = data.kernel || 'js-reference';
    this.pressureRange = data.pressureRange || null;
    this.inspection = data.inspection;
    const byId = new Map(data.diagnostics.map(d => [d.id, d]));
    for (const s of this.simulation.systems) {
      const d = byId.get(s.id);
      if (d) {
        if (s.kind === 'cloud' && Number.isFinite(d.cloudU) && Number.isFinite(d.cloudV)) {
          s.cloudU = d.cloudU; s.cloudV = d.cloudV;
        }
        s.convection = d.convection; s.fieldHumidity = d.humidity;
        s.fieldVorticity = d.vorticity; s.fieldConvergence = d.convergence;
        s.landEnergy = d.landEnergy;
        s.fieldCoreSymmetry = d.coreResolved ? d.coreSymmetry : null;
        s.fieldCoreCloud = d.coreResolved ? d.coreCloud : null;
      }
    }
    for (const candidate of data.candidates || []) {
      if (this.simulation.systems.length >= 128) break; // reserve user-created slots
      this.simulation.add('cloud', candidate.lon, candidate.lat, { ...candidate, injected: false });
    }
    this.invalidate();
  }
  update(now) {
    if (this.presentation.paint(now)) {
      this.frameCount++; this.invalidate();
    }
    const interval = cloudDispatchInterval(this.workMeanMs, this.requestedRate);
    if (this.error || this.pending) return;
    const sim = this.simulation;
    const revision = cloudSolutionKey(sim, this.layer);
    if (revision === this.revision) {
      // Pointer sampling must also work while paused, but must not regenerate
      // and transfer megabytes of unchanged cloud pixels on every mouse move.
      const probeKey = this.probe ? `${this.probe.lon}:${this.probe.lat}` : '';
      if (probeKey && probeKey !== this.probeKey && now - (this.lastInspection ?? -Infinity) >= 100) {
        this.probeKey = probeKey; this.lastInspection = now;
        if (this.worker) { this.pending = true; this.worker.postMessage({ type: 'inspect', probe: this.probe }); }
        else this.inspection = this.fallback.inspect(this.probe);
      }
      return;
    }
    // A paused map has no future animation tick to service a throttled menu
    // selection. Let layer/season edits publish immediately, still single-flight.
    const edited=this.requestedLayer!==this.layer||this.requestedEnvironment!==sim.env.revision;
    if (!edited && now - this.lastRequest < interval) return;
    this.requestedLayer=this.layer;this.requestedEnvironment=sim.env.revision;
    this.revision = revision;
    // Keep the fractional deadline: e.g. 48 numerical ticks/s on a 60Hz
    // display must not round down to one tick every TWO display frames.
    this.lastRequest = Number.isFinite(this.lastRequest) ? now - ((now - this.lastRequest) % interval) : now;
    this.pending = true;
    this.probeKey = this.probe ? `${this.probe.lon}:${this.probe.lat}` : '';
    const data = { hours: sim.hours, env: sim.env, layer: this.layer, probe: this.probe, view: this.view, selectedId: sim.selectedId, ocean: sim.ocean.snapshot(sim.hours),
      systems: sim.systems.map(({ trail, ...s }) => s) };
    if (this.worker) this.worker.postMessage(data);
    else {
      try {
        this.fallback.setOcean(data.ocean);
        this.fallback.advance(Math.max(0, sim.hours - this.fallback.time), sim.env, data.systems);
        this.cpuSky.update(this.fallback,data.systems);
        const cloud=this.layer==='cloud'||this.layer==='day-night'||this.layer==='convection'||isInfrared(this.layer);
        const sky=cloud?this.cpuSky:this.fallback;
        this.accept({ width: sky.width, height: sky.height,
          buffer: sky.pixels(this.layer).buffer, hours: this.fallback.time,
          diagnostics: this.fallback.diagnostics(data.systems), inspection: this.fallback.inspect(this.probe), layer: this.layer });
      } catch (error) { this.fail(error); }
    }
  }
  displayedSunHours(){
    return this.sunFrom+(this.sunTo-this.sunFrom)*this.presentation.alpha;
  }
  draw(context, simulation, project, scale, width, height, drawCoasts) {
    if (this.frameCount) {
      const origin = project(-180, 0, false).x, worldWidth = Math.PI * 2 * scale;
      const first = Math.floor(-origin / worldWidth), last = Math.floor((width - origin) / worldWidth);
      const worlds = [];
      for (let world = first; world <= last; world++) {
        const a = project(-180 + world * 360, 85, false), b = project(180 + world * 360, -85, false);
        worlds.push({ a, b });
      }
      this.presentation.draw(context, worlds, width, height);
      if(this.lastLayer==='day-night')
        this.terminator.draw(context,solarPosition(this.displayedSunHours(),this.sunSeason),project,scale,width);
      if (this.lastLayer?.startsWith('ir-')) drawCoasts?.();
    }
    const visible = simulation.systems.filter(visibleSystem);
    if (this.showWindRings) {
      context.save(); context.strokeStyle = 'rgba(84, 70, 137, .5)'; context.lineWidth = 1.2; context.setLineDash([5, 7]);
      for (const pole of circulationState(simulation.env, simulation.hours).poles) {
        if (pole.strength < .1) continue;
        context.beginPath(); let previous = null;
        for (let lon = -180; lon <= 180; lon += 3) {
          const p = project(lon, polarBoundary(pole, lon));
          if (!previous || Math.abs(p.x - previous.x) > width / 2) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y);
          previous = p;
        }
        context.stroke();
        const label = project(0, pole.sign * (pole.latitude + 5));
        context.font = '12px -apple-system, sans-serif'; context.textAlign = 'center'; context.fillStyle = '#605682';
        context.fillText(say(`${pole.sign > 0 ? '北' : '南'}极涡 · 高空示意`, `${pole.sign > 0 ? 'North' : 'South'} polar vortex · upper air`), label.x, label.y);
      }
      context.restore();
    }
    for (const hit of simulation.landfalls) {
      if (simulation.hours - hit.hour > 120) continue;
      const p = project(hit.lon, hit.lat);
      context.save(); context.translate(p.x, p.y); context.rotate(Math.PI / 4);
      context.fillStyle = '#d84942'; context.strokeStyle = '#fff'; context.lineWidth = 1.5;
      context.beginPath(); context.rect(-6, -6, 12, 12); context.fill(); context.stroke(); context.restore();
      context.fillStyle = '#fff'; context.font = 'bold 10px sans-serif'; context.textAlign = 'center'; context.fillText('!', p.x, p.y + 3);
      context.fillStyle = '#8b2929'; context.font = '11px sans-serif'; context.fillText(`${t(trackLabel(hit))} ${say("登陆","landfall")}`, p.x, p.y + 21);
    }
    for (const s of visible) {
      if (isHighLatitudeSystem(s)) {
        if (!this.showWindRings) continue;
        const contour = [];
        for (let angle = 0; angle <= 360; angle += 6) {
          contour.push(destination(s.lon, s.lat, angle, s.radius));
        }
        context.strokeStyle = '#207847'; context.lineWidth = 1.5;
        drawWrappedContour(context, s, contour, project, scale, width, false); continue;
      }
      context.beginPath();
      let lastX = NaN;
      for (const position of s.trail) {
        const p = project(position[0], position[1]);
        if (Math.abs(lastX - p.x) < Math.PI * scale) context.lineTo(p.x, p.y); else context.moveTo(p.x, p.y);
        lastX = p.x;
      }
      context.strokeStyle = s.id === simulation.selectedId ? 'rgba(255,218,119,.9)' : 'rgba(255,255,255,.48)';
      context.lineWidth = 1.4; context.setLineDash([3, 4]); context.stroke(); context.setLineDash([]);
      if (this.showWindRings && s.kind !== 'anticyclone') this.drawRings(context, s, project, scale, width);
    }
    context.textAlign = 'left'; context.textBaseline = 'middle';
    for (const s of visible) {
      if (isHighLatitudeSystem(s)) continue;
      const p = project(s.lon, s.lat), selected = s.id === simulation.selectedId;
      if (p.x < -100 || p.x > width + 100 || p.y < -30 || p.y > height + 30) continue;
      // Keep the eye unobstructed; hit testing still uses the circulation centre.
      context.font = '600 11px -apple-system, sans-serif';
      context.fillStyle = isInfrared(this.layer) ? '#edf4fa' : '#143b51';
      context.shadowColor = isInfrared(this.layer) ? '#142536' : '#ffffff'; context.shadowBlur = 5;
      context.fillText(`${t(trackLabel(s))} · ${stormText(systemLabel(s))}`, p.x + 15, p.y - 6);
      context.font = '10px -apple-system, sans-serif';
      context.fillText(`${Math.round(toKnots(s.wind))} kt${s.absorbedBy ? say(' · 正被吞并',' · merging') : s.fuji > .10 ? say(' · 双涡作用',' · binary interaction') : ''}`, p.x + 15, p.y + 9);
      context.shadowBlur = 0;
      if (selected && simulation.heading !== null) {
        context.beginPath(); context.moveTo(p.x + Math.cos(simulation.heading) * 28, p.y - Math.sin(simulation.heading) * 28);
        context.lineTo(p.x + Math.cos(simulation.heading) * 54, p.y - Math.sin(simulation.heading) * 54);
        context.strokeStyle = '#fff1a9'; context.lineWidth = 2; context.stroke();
      }
    }
    context.textBaseline = 'alphabetic';
  }
  drawRings(ctx, storm, project, scale, width) {
    // Cache geodesic vertices while only cloud interpolation/camera changes.
    // All rings are plain outlines: no optical mask, texture readback or glass.
    for (const ring of stormRingGeometry(storm)) {
      ctx.strokeStyle = ring.color; ctx.lineWidth = 1.2;
      ctx.setLineDash(ring.dashed ? [5,5] : []);
      drawWrappedContour(ctx, storm, ring.points, project, scale, width, false);
    }
    ctx.setLineDash([]);
  }
}
