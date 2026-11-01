import {namingBasin} from './storm-names.js';
import {wrapLongitude} from './geography.js';

// Short map IDs. M is a simulator extension for Medicanes, not a WMO code.
export function basinLetter(lon,lat) {
  switch (namingBasin(lon,lat)) {
    case 'northwest-pacific': return 'W';
    case 'central-pacific': return 'C';
    case 'northeast-pacific': return 'E';
    case 'north-atlantic': return 'L';
    case 'north-indian': return wrapLongitude(lon)<77 ? 'A' : 'B';
    case 'mediterranean': return 'M';
    case 'south-atlantic': return 'Q';
    case 'australian': return wrapLongitude(lon)<135 ? 'S' : 'P';
    case 'southwest-indian': return 'S';
    default: return 'P';
  }
}
const code = (n,letter) => String(n).padStart(2,'0')+letter;
export const trackLabel = s => s.trackCode || '未编号';

export class StormIdentifiers {
  constructor(startDay) {
    this.startDay=startDay;
    this.formal=new Map(); this.invest=new Map();
  }
  update(s,systems,hours) {
    if ((s.kind!=='disturbance' && s.kind!=='subtropical') || s.wind<7) return;
    const letter=basinLetter(s.lon,s.lat);
    const crossing = (s.trackLetter==='L' && letter==='E') || (s.trackLetter==='E' && letter==='L');
    if (s.trackStage==='cyclone' && !crossing) return;
    // A disturbance is not a numbered depression merely because it is visible.
    // This organization/wind gate is a model proxy for an advisory decision.
    const kt=s.wind*3600/1852, formal=s.trackStage==='cyclone' || kt>=34-1e-10 || (kt>=25 && s.organization>=.35);
    if (!formal && s.trackCode && s.trackLetter===letter) return;
    const used=n=>systems.some(other=>other!==s && other.trackCode===code(n,letter));
    let n;
    if (formal) {
      // Season clock is independent of edits to the weather's seasonal forcing.
      const season=Math.floor((this.startDay-1+hours/24-(s.lat<0?181:0))/365);
      const key=letter+':'+season;
      n=(this.formal.get(key)||0)+1;
      while ((n>=90 && n<100) || used(n)) n++;
      this.formal.set(key,n);
    } else {
      const start=this.invest.get(letter)||0;
      for(let j=0;j<10;j++) {
        const i=(start+j)%10;
        if (!used(90+i)) {n=90+i; this.invest.set(letter,(i+1)%10); break;}
      }
    }
    if (s.trackStage==='invest' && s.trackCode && (formal || s.trackLetter!==letter)) s.lastInvestCode=s.trackCode;
    s.trackStage=formal?'cyclone':'invest'; s.trackLetter=letter;
    s.displayNumber=n; s.trackCode=n==null?null:code(n,letter);
  }
}
