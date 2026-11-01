import { Simulation, systemLabel, regionalGrade, gradeNote, isHighLatitudeSystem, visibleSystem, toKnots, pacificLongitude, windRadii } from './simulation.js?v=global-39';
import { CloudRenderer } from './cloud-renderer.js?v=global-39';
import { formatCoordinate } from './map-math.js';
import { EnvironmentEditor } from './environment-editor.js?v=global-39';
import { PopupMenu } from './popup-menu.js';
import { MAP_LAYERS, INITIAL_RADIUS, radiusFromPosition, positionFromRadius, spawnOptions, nextTimeRate } from './weather-options.js?v=global-39';
import { pressureRange } from './pressure-field.js';
import { circulationRadius } from './wind-rings.js';
import { trackLabel } from './storm-identifiers.js';
import { SimulationClock } from './cloud-clock.js';
import { isInfrared, scaleRGBA } from './satellite-scales.js?v=global-39';

export class WeatherSandbox {
  constructor({ canvas, screenPoint, locate, follow, invalidate, isLand, elevation, makeLandMask }) {
    this.canvas = canvas; this.screenPoint = screenPoint; this.locate = locate;
    this.follow = follow; this.invalidate = invalidate;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.sim = new Simulation(seed, isLand, elevation); this.sim.populate();
    this.clouds = new CloudRenderer(invalidate, this.sim, makeLandMask);
    this.paused = false; this.rate = 1; this.previousTime = null;
    this.clock = new SimulationClock();
    this.lastUI = -Infinity; this.lastSave = -Infinity; this.menuLocation = null; this.inspectedId = null;
    this.panel = document.querySelector('#environment-panel');
    this.menuElement = document.querySelector('#spawn-menu');
    this.layers = MAP_LAYERS; this.spawnRadius = INITIAL_RADIUS.default; this.randomRadius = false;
    const randomRadius = document.querySelector('#random-radius');
    randomRadius.addEventListener('click', () => {
      this.randomRadius = !this.randomRadius;
      randomRadius.setAttribute('aria-pressed', String(this.randomRadius));
      const slider = document.querySelector('#spawn-radius');
      slider.inert = this.randomRadius;
      slider.setAttribute('aria-disabled', String(this.randomRadius));
      this.radiusControl?.setActive(!this.randomRadius);
      document.querySelector('#spawn-radius-value').textContent = this.randomRadius
        ? '70–800 km' : this.spawnRadius + ' km';
      this.invalidate();
    });
    this.layerMenuElement = document.querySelector('#layer-menu');
    this.layerMenuElement.querySelector('.menu-content').innerHTML = this.layers.map(([key,title]) =>
      `<button role="menuitemradio" aria-checked="${key === 'cloud'}" data-layer="${key}"><svg class="layer-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg><span>${title}</span></button>`).join('');
    this.fields = document.querySelector('#environment-values');
    const fieldNames = ['海表温度', '相对湿度', '垂直风切变', '环境气压', '低层气流', 'ENSO', '副高中心', '副高强度', '海洋热含量', '26°C 水层深度', '季风槽 / 冷空气', '气温 / 凝结水'];
    this.values = fieldNames.map(name => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = name; this.fields.append(dt, dd); return dd;
    });
    this.menu = new PopupMenu(this.menuElement, '[data-spawn]', item => this.spawn(item.dataset.spawn));
    this.layerMenu = new PopupMenu(this.layerMenuElement, '[data-layer]', item => this.selectLayer(item.dataset.layer), () => this.setLayerExpanded(false));
    const radius = document.querySelector('#spawn-radius');
    radius.value = positionFromRadius(this.spawnRadius);
    const updateRadius = () => {
      this.spawnRadius = radiusFromPosition(radius.valueAsNumber);
      radius.setAttribute('aria-valuetext', this.spawnRadius + ' km');
      document.querySelector('#spawn-radius-value').textContent = this.spawnRadius + ' km';
    };
    radius.addEventListener('input', updateRadius); updateRadius();
    this.ranking = document.querySelector('#ranking-panel');
    this.ranking.addEventListener('close', () => {
      document.querySelector('#ranking-toggle').setAttribute('aria-expanded','false');
    });
    document.querySelector('#ranking-toggle').addEventListener('click', () => this.showRanking());
    document.querySelector('#ranking-close').addEventListener('click', () => this.ranking?.close());
    document.querySelector('#pause').addEventListener('click', () => {
      this.paused = !this.paused; this.previousTime = null;
      const button = document.querySelector('#pause');
      button.setAttribute('aria-label', this.paused ? '继续模拟' : '暂停模拟');
      button.innerHTML = this.paused ? '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>';
      this.updateUI();
      invalidate();
    });
    document.querySelector('#time-rate').addEventListener('click', event => {
      this.rate = nextTimeRate(this.rate);
      event.currentTarget.textContent = `${this.rate}h/s`; invalidate();
    });
    document.querySelector('#environment-toggle').addEventListener('click', () => this.showPanel(this.panel.hidden));
    document.querySelector('#wind-rings').addEventListener('click', event => {
      this.clouds.showWindRings = !this.clouds.showWindRings;
      event.currentTarget.setAttribute('aria-pressed', String(this.clouds.showWindRings)); invalidate();
    });
    this.editor = new EnvironmentEditor(this);
    document.querySelector('#genesis-rate').addEventListener('click', () => this.editor.show(true));
    document.querySelector('#environment-edit-toggle').addEventListener('click', () => this.editor.show(!this.editor.isOpen));
    for (const id of ['weather-layer','layer-toggle']) document.querySelector(`#${id}`).addEventListener('click', event => this.showLayers(event.currentTarget));
    // Guidance remains live over the docked inspector; it never covers the storm centre.
    document.addEventListener('pointermove', event => {
      if (event.pointerType === 'mouse' && event.target !== canvas) {
        const rect = canvas.getBoundingClientRect(); this.move({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      }
    });
    document.querySelector('#close-panel').addEventListener('click', () => this.showPanel(false));
    document.querySelector('#release-storm').addEventListener('click', () => this.release());
    document.addEventListener('pointerdown', event => {
      if (!this.menuElement.contains(event.target) && this.menu?.isOpen) this.menu.close();
      if (!this.layerMenuElement.contains(event.target) && !event.target.closest('#layer-toggle,#weather-layer') && this.layerMenu?.isOpen) this.layerMenu.close();
    }, true);
    document.addEventListener('keydown', event => this.handleKeyDown(event));
    document.addEventListener('visibilitychange', () => { this.previousTime = null; if (!document.hidden) invalidate(); });
    window.addEventListener('pagehide', () => this.save());
    this.updateUI();
  }
  get running() { return !this.paused && !document.hidden; }
  handleKeyDown(event) {
    if (event.key === 'Shift' && !event.repeat && !event.defaultPrevented
      && !event.target?.closest?.('input,textarea,[contenteditable="true"]')) {
      this.beginIntervention();
    } else if (event.key === 'Escape') {
      // Escape always releases steering/camera ownership immediately, even
      // if an overlay also needs closing. Never consume it only as menu Back.
      this.release();
      if (this.ranking.open) this.ranking.close();
      else if (this.layerMenu?.isOpen) this.layerMenu.close();
      else if (this.editor.isOpen) this.editor.show(false);
      else if (this.menu?.isOpen) this.menu.close();
      else if (!this.panel.hidden) this.showPanel(false);
    }
  }
  inspectSystem(id) {
    const system = this.sim.systems.find(s => s.id === id && visibleSystem(s));
    if (!system) return;
    // Inspection must not alter the trajectory, grab the camera, or keep
    // steering a previously selected storm while the new data is displayed.
    this.sim.release(); this.inspectedId = id;
    this.menu?.close(); this.layerMenu?.close(); this.showPanel(true);
    this.updateUI(); this.invalidate();
  }
  beginIntervention() {
    const system = this.sim.systems.find(s => s.id === this.inspectedId && visibleSystem(s));
    if (!system || isHighLatitudeSystem(system)) return false;
    this.menu?.close(); this.layerMenu?.close(); this.editor.show(false);
    this.ranking?.close(); this.showPanel(false);
    this.sim.select(system.id);
    this.updateUI(); this.invalidate();
    return true;
  }
  setLayerExpanded(open) {
    for (const id of ['weather-layer','layer-toggle']) document.querySelector(`#${id}`).setAttribute('aria-expanded',String(open));
  }
  showLayers(trigger) {
    if (!this.layerMenu) return;
    if (this.layerMenu.isOpen) { this.layerMenu.close(); return; }
    this.menu?.close(); this.editor.show(false);
    const r = trigger.getBoundingClientRect();
    this.layerMenu.open(r.left,r.bottom,trigger,r.top); this.setLayerExpanded(true);
  }
  selectLayer(layer) {
    const choice = this.layers.find(([key]) => key === layer); if (!choice) return;
    this.clouds.layer = layer;
    this.canvas.closest('.map-shell').dataset.cloudLayer = layer;
    const legend = document.querySelector('#cloud-product-legend');
    const conv = layer === 'convection', ir = isInfrared(layer), solar = layer === 'day-night';
    legend.hidden = !(conv || ir || solar || layer === 'pressure'); legend.dataset.product = layer;
    legend.textContent = conv ? '根据上升凝结和云水估算活跃度；灰色为不活跃云，不是雷达回波。'
      : solar ? '金线为晨昏线。日侧看可见光云水，夜侧看热红外，冷云顶更亮。时间为模拟 UTC。'
      : layer === 'infrared' ? '模拟亮温：深红是冷云顶，较暖的云呈浅色到绿色，+8 °C 及以上透明。'
      : '同一时刻的模拟红外亮温，仅改变增强色表；非实测卫星资料。';
    const scale = document.querySelector('#satellite-scale');
    scale.hidden = !(conv || ir || solar);
    scale.querySelector('canvas').hidden = solar;scale.querySelector('small').hidden = solar;
    if (solar) scale.querySelector('strong').textContent = '昼夜 · 金线为晨昏线（模拟 UTC）';
    if (conv || ir) {
      scale.querySelector('strong').textContent = choice[1] + (conv ? ' · 模拟活跃度' : ' · 模拟亮温 °C');
      const strip = scale.querySelector('canvas'), ctx = strip.getContext('2d');
      ctx.clearRect(0,0,strip.width,strip.height);
      for (let x=0;x<strip.width;x++) {
        const f=x/(strip.width-1);
        const [r,g,b,a]=scaleRGBA(layer,conv?f:layer==='infrared'?8-98*f:40-130*f);
        ctx.fillStyle=`rgba(${r},${g},${b},${a/255})`;
        ctx.fillRect(x,0,1,1);
      }
      const ticks = conv ? ['弱','0.5','强'] : layer==='infrared' ? ['+8','−41','−90'] : ['+40','−25','−90'];
      scale.querySelectorAll('small span').forEach((span,i)=>{span.textContent=ticks[i];});
    }
    document.querySelector('#weather-layer').textContent = `图层：${choice[1]} ▾`;
    for (const item of this.layerMenuElement.querySelectorAll('[data-layer]')) item.setAttribute('aria-checked',String(item.dataset.layer === layer));
    if (layer === 'pressure') this.updatePressureLegend();
    this.invalidate();
  }
  updatePressureLegend() {
    const [min,max] = this.clouds.pressureRange || pressureRange(this.sim.systems);
    document.querySelector('#cloud-product-legend').textContent = `气压 ${min}—${max} hPa · 蓝色较低，橙色较高 · 包含气旋与高压（模拟）`;
  }
  showRanking() {
    this.menu.close(); this.layerMenu.close(); this.showPanel(false); this.editor.show(false);
    this.renderRankings(); this.ranking.showModal();
    document.querySelector('#ranking-toggle').setAttribute('aria-expanded', 'true');
    document.querySelector('#ranking-close').focus({ preventScroll:true });
  }
  renderRankings() {
    const rows = document.querySelector('#ranking-rows');
    if (this.rankingCount === this.sim.completed.length) return;
    this.rankingCount = this.sim.completed.length;
    const records = this.sim.rankings;
    rows.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('p'); empty.className = 'ranking-empty';
      empty.textContent = '还没有结束生命周期的气旋。'; rows.append(empty); return;
    }
    for (const [index, record] of records.entries()) {
      const row = document.createElement('article'); row.className = 'ranking-row';
      const rank = document.createElement('span'); rank.textContent = String(index + 1).padStart(2, '0');
      const title = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = [trackLabel(record), record.stormName, record.name].filter(Boolean).join(' · ');
      detail.textContent = `持续 ${(record.endHour - record.startHour).toFixed(1)} 小时 · ${record.reason}`;
      title.append(name, detail);
      const result = document.createElement('div'); result.className = 'ranking-result';
      const wind = document.createElement('strong'), pressure = document.createElement('small');
      wind.textContent = `${record.peakKnots} kt`; pressure.textContent = `${record.minimumPressure.toFixed(1)} hPa`;
      if (record.gradeColor) wind.style.color = record.gradeColor;
      if (record.gradeNote) row.title = record.gradeNote;
      result.append(wind, pressure); row.append(rank, title, result); rows.append(row);
    }
  }
  update(time) {
    const elapsed = this.previousTime === null ? 0 : Math.min(.25, Math.max(0, (time - this.previousTime) / 1000));
    const dt = Math.min(.08, elapsed);
    this.previousTime = time;
    // Camera/controls remain on the display clock. Circulation integrates on
    // the cloud's 24 Hz clock, not 120 full-system scans per second.
    this.physicsElapsed = (this.physicsElapsed || 0) + (this.running ? elapsed : 0);
    if (this.running && this.physicsElapsed >= (this.rate >= 12 ? 0 : 1 / 24)) {
      // Back-pressure keeps circulation and moist-field time together on slow devices.
      // Never let the visible numerical atmosphere fall hours/days behind the markers.
      const advance = this.clock.advance(this.physicsElapsed, this.rate, true, this.sim.hours, this.clouds.fieldHours ?? 0);
      const started = performance.now();
      if (advance > 1e-8) this.sim.advance(advance);
      this.physicsPeakMs = Math.max(this.physicsPeakMs || 0, performance.now() - started);
      this.physicsElapsed = 0;
    }
    if (!this.running) { this.physicsElapsed = 0; this.clock.advance(0, this.rate, false, this.sim.hours, 0); }
    this.clouds.requestedRate = this.rate;
    this.clouds.update(time);
    // Diagnostics and DOM labels are not an animation clock. Rewriting all
    // of them on every display frame also woke layout while a menu was held.
    if (time - (this.lastMetrics ?? -Infinity) >= 250) {
      this.lastMetrics = time;
      this.canvas.dataset.cloudFrames = String(this.clouds.frameCount);
      this.canvas.dataset.cloudWorkerFrames = String(this.clouds.workerFrames || 0);
      this.canvas.dataset.cloudHours = String(this.clouds.lastHours);
      this.canvas.dataset.cloudKernel = this.clouds.kernel || 'initializing';
      this.canvas.dataset.cloudWorkMs = String(this.clouds.workMs || 0);
      this.canvas.dataset.cloudWorkMeanMs = String(this.clouds.workMeanMs || 0);
      this.canvas.dataset.cloudDetailCount = String(this.clouds.patches.length);
      this.canvas.dataset.simulationHours = String(this.sim.hours);
      this.canvas.dataset.simulationStepPeakMs = String(this.physicsPeakMs || 0);
      this.canvas.dataset.simulationActualRate = String(this.clock.actualRate);
      this.canvas.dataset.simulationTargetRate = String(this.rate);
      const rate = document.querySelector('#time-rate');
      rate.title = `目标 ${this.rate}h/s · 实际 ${this.clock.actualRate.toFixed(1)}h/s（保留完整网格与物理步长）`;
      document.querySelector('#actual-rate').textContent = this.running
        ? `实际 ${this.clock.actualRate.toFixed(1)}h/s` : '已暂停';
      this.physicsPeakMs = 0;
    }
    const lastEvent = this.sim.events.at(-1);
    if (lastEvent && lastEvent !== this.lastEvent) { this.lastEvent = lastEvent; this.notify(lastEvent.message); }
    const selected = this.sim.systems.find(s => s.id === this.sim.selectedId);
    if (selected) this.follow(selected.lon, selected.lat, dt);
    if (time - this.lastUI > 250 || this.lastSelectedUI !== this.sim.selectedId) {
      this.lastUI = time; this.lastSelectedUI = this.sim.selectedId; this.updateUI();
    }
    if (time - this.lastSave > 5000) { this.lastSave = time; this.save(); }
  }
  draw(context, scale, width, height, drawCoasts) { this.clouds.draw(context, this.sim, this.screenPoint, scale, width, height, drawCoasts); }
  showPanel(show) {
    if (show) this.editor?.show(false);
    this.panel.hidden = !show;
    document.querySelector('#environment-toggle').setAttribute('aria-pressed', String(show));
    this.updateUI(); this.invalidate();
  }
  release() { this.sim.release(); this.updateUI(); this.invalidate(); }
  pan() { this.menu?.close(); this.layerMenu?.close(); this.release(); }
  move(position) {
    if (this.ranking.open) return;
    const probe = this.locate(position);
    this.probe = { lon: pacificLongitude(probe.longitude), lat: probe.latitude };
    if (this.menu.isOpen || this.layerMenu.isOpen || this.editor.isOpen) return;
    const selected = this.sim.systems.find(s => s.id === this.sim.selectedId);
    if (!selected || isHighLatitudeSystem(selected)) return;
    const center = this.screenPoint(selected.lon, selected.lat);
    const dx = position.x - center.x, dy = center.y - position.y;
    if (Math.hypot(dx, dy) > 26) this.sim.steer(dx, dy);
    this.invalidate();
  }
  tap(position) {
    if (this.layerMenu.isOpen) { this.layerMenu.close(); return; }
    const nearest = this.sim.systems.filter(visibleSystem).map(s => {
      const p = this.screenPoint(s.lon, s.lat); return { s, distance: Math.hypot(p.x - position.x, p.y - position.y) };
    }).sort((a, b) => a.distance - b.distance)[0];
    if (nearest?.distance < 24) {
      this.inspectSystem(nearest.s.id); return;
    }
    this.menuLocation = this.locate(position);
    this.menuLocation.longitude = pacificLongitude(this.menuLocation.longitude);
    if (Math.abs(this.menuLocation.latitude) > 85) {
      this.notify('墨卡托模拟范围为南北纬 85° 之间'); return;
    }
    this.menu.open(position.x, position.y, this.canvas);
  }
  spawn(kind) {
    if (!this.menuLocation) return;
    const { longitude, latitude } = this.menuLocation;
    if (kind === 'disturbance' && this.sim.isLand(longitude, latitude)) {
      this.notify('热带扰动需要海面；陆地上可以生成云团'); return;
    }
    const options = spawnOptions(kind, this.spawnRadius, this.randomRadius ? this.sim.rng : null);
    const created = this.sim.add(kind === 'low' ? 'disturbance' : kind, longitude, latitude, options);
    if (created) { this.canvas.dataset.lastSpawnRadius = String(created.radius); this.canvas.dataset.lastSpawnKind = kind; }
    if (!created) this.notify('当前已达 160 个环流候选的计算上限');
    else this.notify(kind === 'cloud' ? '云团已生成，将随环境演变'
      : [systemLabel(created) + '已生成', options.customRadius ? '环流 ' + created.birthRadius + ' km' : '', '点击中心查看'].filter(Boolean).join(' · '));
    this.updateUI(); this.save(); this.invalidate();
  }
  notify(message) {
    const element = document.querySelector('#notification');
    element.textContent = message; element.hidden = false;
    clearTimeout(this.notificationTimer);
    this.notificationTimer = setTimeout(() => { element.hidden = true; this.invalidate(); }, 2600);
    this.invalidate();
  }
  updateUI() {
    if (this.ranking.open) this.renderRankings();
    if (this.clouds.layer === 'pressure') this.updatePressureLegend();
    const hours = this.sim.hours;
    document.querySelector('#sim-time').textContent = `第 ${Math.floor(hours / 24) + 1} 天 · ${String(Math.floor(hours % 24)).padStart(2, '0')}:${String(Math.floor(hours * 60 % 60)).padStart(2, '0')}`;
    const storms = this.sim.systems.filter(visibleSystem);
    document.querySelector('#system-count').textContent = this.clouds.error ? '云场计算异常 · 请刷新' : `${storms.filter(s => s.kind === 'disturbance').length} 热带 · ${storms.filter(s => s.kind === 'subtropical').length} 亚热带 · ${storms.filter(s => s.kind === 'extratropical').length} 温带 · ${storms.filter(s => s.kind === 'anticyclone').length} 高压 · ${this.sim.systems.filter(s => s.kind === 'cloud').length} 云候选`;
    const selected = this.sim.systems.find(s => s.id === (this.sim.selectedId ?? this.inspectedId));
    this.canvas.dataset.systemCount = String(this.sim.systems.length);
    this.canvas.dataset.selectedStorm = selected ? String(selected.id) : '';
    this.canvas.dataset.intervenedStorm = this.sim.selectedId === null ? '' : String(this.sim.selectedId);
    const status = document.querySelector('#selected-status');
    status.hidden = !selected || isHighLatitudeSystem(selected);
    if (selected) {
      let wind = status.querySelector('.selected-wind');
      if (!wind) { wind = document.createElement('span'); wind.className = 'selected-wind'; status.replaceChildren(wind, document.createTextNode('')); }
      wind.textContent = `${Math.round(toKnots(selected.wind))} kt`;
      wind.style.color = regionalGrade(selected)?.color || 'inherit';
      status.title = `${systemLabel(selected)} · ${gradeNote(selected)}`;
      status.setAttribute('aria-label', `${systemLabel(selected)}，${Math.round(toKnots(selected.wind))} 节，${Math.round(selected.pressure)} 百帕，${selected.speed.toFixed(1)} 公里每小时`);
      status.lastChild.textContent = ` · ${Math.round(selected.pressure)} hPa · ${selected.speed.toFixed(1)} km/h`;
    }
    // The docked wind/speed display above stays live. Closed inspectors need
    // neither quadrant diagnostics nor worker round-trips for pointer sampling.
    if (this.panel.hidden) { this.clouds.probe = null; return; }
    const point = selected || this.probe || { lon: 135, lat: 20 };
    const e = this.sim.environmentAt(point.lon, point.lat);
    this.clouds.probe = { lon: point.lon, lat: point.lat };
    const grid = this.clouds.inspection;
    if (grid && Math.hypot(grid.lon - point.lon, grid.lat - point.lat) < 1) Object.assign(e, {
      sst: grid.sst, humidity: grid.humidity, shear: grid.shear, pressure: grid.pressure, ohc: grid.ohc,
      temperature: grid.temperature, water: grid.water,
    });
    document.querySelector('#system-title').textContent = selected ? `${isHighLatitudeSystem(selected) && !selected.trackCode ? '' : trackLabel(selected) + ' · '}${systemLabel(selected)}` : `环境 · ${formatCoordinate(point.lon, point.lat)}`;
    document.querySelector('#system-summary').textContent = selected
      ? `${Math.round(toKnots(selected.wind))} kt（${selected.wind.toFixed(1)} m/s，1 分钟平均）· ${Math.round(selected.pressure)} hPa · 移速 ${selected.speed.toFixed(1)} km/h。${selected.absorbedBy ? '正在被吞并。' : selected.fuji > .1 ? '双涡作用正在发展。' : ''}${isHighLatitudeSystem(selected) ? '' : this.sim.selectedId === selected.id ? '正在手动干预；光标只控制方向，Esc 结束。' : '按 Shift 关闭菜单并开始手动干预。'}`
      : '随机合成气象场，非实况或预报。云水实时演算；低于 7m/s 的环流不标记。可切换云水、对流、红外和环境图层。';
    const enso = e.enso > .5 ? '厄尔尼诺' : e.enso < -.5 ? '拉尼娜' : '中性';
    const data = [`${e.sst.toFixed(1)} °C`, `${Math.round(selected?.fieldHumidity ?? e.humidity)} %`, `${e.shear.toFixed(1)} m/s`, `${e.pressure.toFixed(0)} hPa`, `${Math.hypot(e.u, e.v).toFixed(1)} km/h`, `${enso} ${e.enso > 0 ? '+' : ''}${e.enso.toFixed(1)}`, `${e.ridgeLon.toFixed(1)}°E ${e.ridgeLat.toFixed(1)}°N`, `${this.sim.env.ridgePressure.toFixed(0)} hPa`, `${e.ohc.toFixed(1)} kJ/cm²`, `${Math.round(e.depth26)} m`, `${Math.round(e.trough * 100)}% / ${Math.round(e.cold * 100)}%`];
    data.push(`${e.temperature.toFixed(1)}°C / ${(e.water ?? selected?.convection ?? 0).toFixed(2)} g/kg`);
    data.forEach((value, i) => { this.values[i].textContent = value; });
    document.querySelector('#release-storm').hidden = this.sim.selectedId === null;
    document.querySelector('#wind-radii').textContent = selected
      ? `环流范围：${Math.round(circulationRadius(selected))} km（非固定风速等级）\n模拟风圈 km · 东北/东南/西南/西北\n${windRadii(selected).map((radii, i) => `${[7, 10, 12][i]}级：${radii.map(Math.round).join(' / ')}`).join('\n')}\n风眼组织度 ${Math.round(selected.eye * 100)}%`
      : '7 / 10 / 12 级：13.9 / 24.5 / 32.7 m/s。四象限模拟半径，不等同 CMA 业务数据或平均时段。';
    document.querySelector('#seed-info').textContent = `种子 ${this.sim.seed.toString(16).toUpperCase()} · NOAA 1991–2020 气候背景 · 非实况`;
  }
  save() {
    try { localStorage.setItem('typhoon-plain:last-numerical-state', JSON.stringify(this.sim.snapshot())); }
    catch { /* Storage denial/quota never stops the simulation. */ }
  }
}
