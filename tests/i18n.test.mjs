import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLanguage, t, stormText, eventText} from '../dist/i18n.js';
import {MAP_LAYERS} from '../dist/weather-options.js';
import {ENV_CONTROLS, ENV_EVENTS} from '../dist/environment-config.js';
import * as grades from '../dist/cyclone-grades.js';
test('first launch is English; valid links override saved preferences',()=>{
  assert.equal(resolveLanguage(null,null),'en');
  assert.equal(resolveLanguage(null,'zh'),'zh');
  assert.equal(resolveLanguage('en','zh'),'en');
  assert.equal(resolveLanguage('zh','en'),'zh');
  assert.equal(resolveLanguage('unsupported','invalid'),'en');
});
test('all layers, environmental controls, regional grades and events translate',()=>{
  const strings=[...MAP_LAYERS.map(row=>row[1]),...ENV_CONTROLS.map(c=>c.label),...Object.values(ENV_EVENTS)];
  for(const [key,value] of Object.entries(grades)){
    if(key.endsWith('_GRADES'))strings.push(...value.map(g=>g.name));
  }
  for(const str of strings)assert.doesNotMatch(t(str),/\p{Script=Han}/u,str);
  assert.equal(stormText('Haixing · 超级台风'),'Haixing · Super typhoon');
  assert.equal(eventText('01W 转为温带气旋'),'01W transitioned to Extratropical cyclone');
});
