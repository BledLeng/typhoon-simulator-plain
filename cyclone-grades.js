import { isMediterranean } from './geography.js';

export const toKnots = wind => wind * 3600 / 1852;
export const pacificLongitude = lon => ((lon % 360) + 360) % 360;
const table = rows => Object.freeze(rows.map(([minKnots, name, color]) => Object.freeze({ minKnots, name, color })));
const PINK = '#ef69b5', RED = '#e23b47', ORANGE = '#d86b17', AMBER = '#eaa34c';
const YELLOW = '#e0ba42', BLUE = '#3189bd', PALE = '#eaf9ff';

// Display thresholds use the model's ONE-minute wind throughout. Regional
// terminology/thresholds below are adapted from the WMO comparison table, not
// operational 3-/10-minute agency grades or a claim of exact wind conversion.
export const TYPHOON_GRADES = table([
  [130, '超级台风', PINK], [115, '暴力台风', RED], [95, '强台风', ORANGE],
  [64, '台风', AMBER], [48, '强热带风暴', YELLOW], [34, '热带风暴', BLUE], [0, '热带低压', PALE],
]);
// NHC uses one-minute winds: these category thresholds need no conversion.
export const HURRICANE_GRADES = table([
  [137, '第五类飓风', PINK], [113, '第四类飓风', RED], [96, '第三类飓风', ORANGE],
  [83, '第二类飓风', AMBER], [64, '第一类飓风', YELLOW], [34, '热带风暴', BLUE], [0, '热带低压', PALE],
]);
export const INDIAN_GRADES = table([
  [120, '超级气旋风暴', PINK], [90, '极强气旋风暴', RED], [64, '特强气旋风暴', ORANGE],
  [48, '强气旋风暴', AMBER], [34, '气旋风暴', BLUE], [28, '深低压', '#63a9cb'], [0, '低压', PALE],
]);
export const SOUTHWEST_INDIAN_GRADES = table([
  [116, '特强热带气旋', PINK], [90, '强烈热带气旋', RED], [64, '热带气旋', ORANGE],
  [48, '强热带风暴', AMBER], [34, '中等热带风暴', BLUE], [28, '热带低压', '#63a9cb'], [0, '热带扰动', PALE],
]);
export const AUSTRALIAN_GRADES = table([
  [108, '第五类强热带气旋', PINK], [86, '第四类强热带气旋', RED], [64, '第三类强热带气旋', ORANGE],
  [48, '第二类热带气旋', AMBER], [34, '第一类热带气旋', BLUE], [0, '热带低压', PALE],
]);
export const MEDITERRANEAN_GRADES = table([
  [96, '极强地中海气旋', RED], [64, '强烈地中海气旋', ORANGE],
  [34, '地中海气旋', BLUE], [0, '地中海低压', PALE],
]);
export const GENERIC_CYCLONE_GRADES = table([
  [116, '特强热带气旋', PINK], [90, '强烈热带气旋', RED], [64, '热带气旋', ORANGE],
  [48, '强热带风暴', AMBER], [34, '热带风暴', BLUE], [0, '热带低压', PALE],
]);
export const SUBTROPICAL_GRADES = table([[34, '亚热带风暴', BLUE], [0, '亚热带低压', '#63a9cb']]);
export function cycloneBasin(lon = 135, lat = 20) {
  const east = pacificLongitude(lon);
  if (isMediterranean(lon, lat)) return 'mediterranean';
  if (lat < 0) return east >= 20 && east < 90 ? 'southwest-indian'
    : east >= 90 && east < 160 ? 'australian' : east >= 160 && east < 290 ? 'south-pacific' : 'southern';
  if (east >= 40 && east < 100) return 'north-indian';
  return east >= 100 && east < 180 ? 'northwest-pacific' : 'hurricane';
}
export const REGIONAL_SCALES = Object.freeze({
  'northwest-pacific': { grades: TYPHOON_GRADES, note: '西北太平洋 · 1 分钟风速 · 自定义台风等级' },
  hurricane: { grades: HURRICANE_GRADES, note: 'NHC 飓风等级 · 1 分钟风速' },
  'north-indian': { grades: INDIAN_GRADES, note: '北印度洋 · 1 分钟模拟映射，非 IMD 3 分钟官方定级' },
  'southwest-indian': { grades: SOUTHWEST_INDIAN_GRADES, note: '西南印度洋 · 1 分钟模拟映射，非当地 10 分钟官方定级' },
  australian: { grades: AUSTRALIAN_GRADES, note: '澳大利亚 · 1 分钟模拟映射，非当地 10 分钟官方定级' },
  'south-pacific': { grades: AUSTRALIAN_GRADES, note: '南太平洋 · 1 分钟模拟映射，非当地 10 分钟官方定级' },
  mediterranean: { grades: MEDITERRANEAN_GRADES, note: '地中海 · 1 分钟风速 · 模拟器自定义等级' },
  southern: { grades: GENERIC_CYCLONE_GRADES, note: '其他南半球海域 · 1 分钟风速 · 模拟器自定义等级' },
});
const gradeAt = (grades, wind) => grades.find(grade => toKnots(wind) + 1e-10 >= grade.minKnots) || grades.at(-1);
export const typhoonGrade = wind => gradeAt(TYPHOON_GRADES, wind);
export const regionalGrade = s => gradeAt(s.kind === 'subtropical' ? SUBTROPICAL_GRADES : REGIONAL_SCALES[cycloneBasin(s.lon, s.lat)].grades, s.wind);
export const gradeNote = s => s.kind === 'subtropical' ? '亚热带气旋 · NHC 1 分钟风速分级 · 混合结构模拟' : REGIONAL_SCALES[cycloneBasin(s.lon, s.lat)].note;
export function classification(wind, lon = 135, lat = 20, organization = 1) {
  const basin = cycloneBasin(lon, lat);
  if (toKnots(wind) < 34 && organization < .35) return basin === 'mediterranean' ? '地中海扰动' : '热带扰动';
  return regionalGrade({ wind, lon, lat }).name;
}
