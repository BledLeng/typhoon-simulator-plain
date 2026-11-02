import {bindMarkup, say, t} from './i18n.js';
import { ENV_CONTROLS, ENV_EVENTS, setEnvironmentValue, startEnvironmentEvent } from './environment-config.js?v=global-39';
import { environment } from './simulation.js?v=eye-42';

const groups = ['基础', '环流', '事件'];
const eventControls = [
  {key:'eventStrength', label:'事件强度', min:.25, max:2, step:.25, unit:'×', group:'事件'},
  {key:'eventDuration', label:'持续时间', min:12, max:120, step:12, unit:'h', group:'事件'},
];
const specs = [...ENV_CONTROLS, ...eventControls];
const range = s => `<label class="setting" for="env-${s.key}"><span>${s.label}<output for="env-${s.key}"></output></span>
  <input type="range" id="env-${s.key}" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}"></label>`;

export class EnvironmentEditor {
  constructor(weather) {
    this.weather = weather;
    this.eventValues = {eventStrength:1, eventDuration:48};
    const el = this.element = document.querySelector('#environment-editor');
    el.innerHTML = `<header class="panel-title"><strong>环境自定义</strong><button id="editor-close" aria-label="关闭环境设置">×</button></header>
      <nav role="tablist" aria-label="环境设置分类">${groups.map((g,i) => `<button role="tab" id="tab-${i}" aria-controls="env-page-${i}">${g}</button>`).join('')}</nav>
      <div class="environment-scroll">${groups.map((g,i) => `<section id="env-page-${i}" role="tabpanel" aria-labelledby="tab-${i}">${specs.filter(s => s.group === g).map(range).join('')}
      ${i===2 ? `<div class="event-buttons">${Object.entries(ENV_EVENTS).map(([k,label]) => `<button data-event="${k}">${label}</button>`).join('')}</div>
        <p>事件作用于选中的风暴或最近的地图位置，逐渐增强、消退。</p><output id="active-events"></output><button id="clear-events">结束所有事件</button>` : ''}</section>`).join('')}
      <p>生成倍率只调节概率；即便调到 4×，也需要适宜的环境。</p><button id="reset-environment">恢复本次随机环境</button></div>`;
    bindMarkup(el);
    this.controls = specs.map(spec => [spec, el.querySelector('#env-'+spec.key)]);
    const tabs = [...el.querySelectorAll('[role=tab]')];
    const select = index => {
      tabs.forEach((tab,i) => {
        tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1;
        document.getElementById(tab.getAttribute('aria-controls')).hidden = i !== index;
      });
      el.querySelector('.environment-scroll').scrollTop = 0;
    };
    tabs.forEach((tab,i) => {
      tab.onclick = () => select(i);
      tab.onkeydown = e => {
        const next = {ArrowRight:(i+1)%3, ArrowLeft:(i+2)%3, Home:0, End:2}[e.key];
        if (next !== undefined) { e.preventDefault(); select(next); tabs[next].focus(); }
      };
    });
    select(0);
    el.addEventListener('input', ({target}) => {
      if (!target.matches('input[type=range]')) return;
      const {key} = target.dataset;
      if (key in this.eventValues) this.eventValues[key] = target.valueAsNumber;
      else { setEnvironmentValue(weather.sim.env,key,target.valueAsNumber); weather.save(); }
      this.sync(); weather.updateUI(); weather.invalidate();
    });
    el.querySelector('#editor-close').onclick = () => this.show(false);
    el.querySelectorAll('[data-event]').forEach(button => button.onclick = () => {
      const sim = weather.sim, point = sim.systems.find(s => s.id === sim.selectedId) || weather.probe || {lon:135,lat:18};
      const ok = startEnvironmentEvent(sim.env, button.dataset.event, sim.hours, {
        intensity:this.eventValues.eventStrength, duration:this.eventValues.eventDuration, lon:point.lon, lat:point.lat,
      });
      weather.notify(ok ? say('已加入','Event added: ')+t(ENV_EVENTS[button.dataset.event]) : t('最多同时设置 6 个事件'));
      this.sync(); weather.invalidate();
    });
    el.querySelector('#clear-events').onclick = () => {
      weather.sim.env.events = []; weather.sim.env.revision++; this.sync(); weather.invalidate();
    };
    el.querySelector('#reset-environment').onclick = () => {
      weather.sim.env = {...environment(weather.sim.seed), revision:weather.sim.env.revision+1};
      this.sync(); weather.updateUI(); weather.invalidate();
    };
    this.sync();
  }
  get isOpen() { return !this.element.hidden; }
  show(open) {
    if (open === this.isOpen) return;
    const trigger = document.querySelector('#environment-edit-toggle');
    trigger.setAttribute('aria-pressed',String(open));
    if (open) {
      this.weather.menu.close(); this.weather.layerMenu.close(); this.weather.showPanel(false); this.sync();
    } else if (this.element.contains(document.activeElement)) trigger.focus({preventScroll:true});
    this.element.hidden = !open;
    if (open) this.element.querySelector('[aria-selected=true]').focus({preventScroll:true});
  }
  sync() {
    const {env,hours} = this.weather.sim;
    this.controls.forEach(([s,input]) => {
      const v = this.eventValues[s.key] ?? env[s.key];
      input.value = v;
      const text = Number(v.toFixed(2))+t(s.unit);
      input.setAttribute('aria-valuetext',text);
      input.labels[0].querySelector('output').textContent = text;
    });
    this.element.querySelector('#active-events').textContent = (env.events||[]).filter(e => e.start+e.duration>hours)
      .map(e => `${t(ENV_EVENTS[e.type])} ${e.intensity}× · ${say("剩余 ","")}${Math.ceil(e.start+e.duration-hours)}${say("h"," h left")}`) .join(say('；','; ')) || t('暂无事件');
    document.querySelector('#genesis-rate').textContent = say('生成概率 ','Genesis ')+env.genesisMultiplier+'×';
  }
}
