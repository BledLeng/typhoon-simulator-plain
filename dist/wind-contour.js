import { longitudeDelta } from './geography.js';

// Unwrap a complete contour first, then place copies of that one polygon.
// Wrapping each vertex independently draws a chord across the whole viewport.
export function projectedWindContours(center, points, project, scale, viewportWidth) {
  if (!points.length) return [];
  let longitude = center.lon;
  const shift = project(center.lon, center.lat).x - project(center.lon, center.lat, false).x;
  const path = points.map(point => {
    longitude += longitudeDelta(point.lon, longitude);
    const p = project(longitude, point.lat, false);
    return { x:p.x + shift, y:p.y, longitude };
  });
  const span = 2 * Math.PI * scale;
  const min = Math.min(...path.map(p => p.x)), max = Math.max(...path.map(p => p.x));
  // A contour around a pole is open in Mercator. Closing/filling its endpoints
  // creates the green screen-wide rectangle; keep only the physical arc.
  const wrapsPole = Math.abs(path.at(-1).longitude - path[0].longitude) > 180;
  const contours = [];
  for (let copy = Math.ceil(-max / span); copy <= Math.floor((viewportWidth - min) / span); copy++) {
    contours.push({ closed: !wrapsPole, points: path.map(p => ({ x:p.x + copy * span, y:p.y })) });
  }
  return contours;
}

export function drawWrappedContour(ctx, center, points, project, scale, viewportWidth, fill = true, collect = null) {
  for (const contour of projectedWindContours(center, points, project, scale, viewportWidth)) {
    ctx.beginPath();
    contour.points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
    if (contour.closed) { ctx.closePath(); if (fill) ctx.fill(); collect?.push(contour.points); }
    ctx.stroke();
  }
}
