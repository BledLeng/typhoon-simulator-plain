import {english} from './messages-en.js';

export const preferenceKey = 'typhoon-plain-language';
export function resolveLanguage(query, saved) {
  return [query, saved].find(v => v === 'en' || v === 'zh') || 'en';
}
export let language = 'en';
if (typeof location !== 'undefined') {
  let saved;
  try { saved = localStorage.getItem(preferenceKey); } catch {}
  language = resolveLanguage(new URLSearchParams(location.search).get('lang'), saved);
}
export const t = source => language === 'en' ? (english[source] ?? source) : source;
export const say = (zh,en) => language === 'en' ? en : zh;
export const stormText = text => language === 'en' ? text.split(' · ').map(t).join(' · ') : text;
const bindings = [];

// Register static controls once, not once per simulation frame. Preserve the
// original text node (including padding) and never recreate interactive DOM.
export function bindMarkup(root) {
  const record = (source, setter) => {
    if (!Object.hasOwn(english,source.trim())) return;
    const update = () => setter(source.replace(source.trim(), () => t(source.trim())));
    bindings.push(update); update();
  };
  const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  for(let n=walker.nextNode();n;n=walker.nextNode()){
    const node=n, source=node.parentElement?.dataset.zhText ?? node.data;
    record(source, value=>{node.data=value;});
  }
  for (const el of root.querySelectorAll('[aria-label],[title],meta[name=description]')) {
    for (const attr of ['aria-label','title','content']) {
      const source=el.getAttribute('data-zh-'+attr) ?? el.getAttribute(attr);
      if(source)record(source, value=>el.setAttribute(attr,value));
    }
  }
}

export function initLanguage(changed) {
  const button=document.querySelector('#language-toggle');
  const update=()=>{
    document.documentElement.lang=say('zh-CN','en');
    button.textContent=say('English','中文');
    button.lang=say('en','zh-CN');
    button.setAttribute('aria-label',say('Switch to English','切换到中文'));
    button.title=say('Switch to English','切换到中文');
    document.querySelector('.map-footer a').href='./credits.html?lang='+language;
  };
  bindMarkup(document);update();
  button.addEventListener('click',()=>{
    language=language==='en'?'zh':'en';
    try {localStorage.setItem(preferenceKey,language);} catch {}
    const url=new URL(location.href);url.searchParams.set('lang',language);
    history.replaceState(history.state,'',url);
    for(const updateBinding of bindings)updateBinding();
    update();changed();
  });
}

// Events remain language-neutral to the saved simulation: localize only when
// the existing model's event string is presented, including old records.
export function eventText(message) {
  if (language==='zh')return message;
  return t(message).replace(/^(.+) 登陆 · (.+)$/,(_,id,wind)=>stormText(id)+' made landfall · '+wind)
    .replace(/^(.+) 转为(.+)$/,(_,id,kind)=>stormText(id)+' transitioned to '+t(kind))
    .replace(/^(.+) 环流并入 (.+)$/,(_,a,b)=>stormText(a)+' merged into '+stormText(b));
}
