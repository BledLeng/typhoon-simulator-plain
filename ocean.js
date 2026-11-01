// Persistent geographic cold wake. Sparse updates, lazy multi-day recovery.
// This is a slab-ocean parameterization, not a 3-D ocean circulation solver.
export class Ocean {
  constructor(isLand) {
    this.west = -180; this.south = -85; this.step = .5; this.width = 720; this.height = 340;
    this.cells = new Map(); this.land = new Map(); this.isLand = isLand;
  }
  value(index, hours) {
    const cell = this.cells.get(index);
    return cell ? cell.cooling * Math.exp(-Math.max(0, hours - cell.hours) / 240) : 0;
  }
  sample(lon, lat, hours) {
    const x = (lon - this.west) / this.step - .5, y = (lat - this.south) / this.step - .5;
    const ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy;
    const at = (xx, yy) => yy < 0 || yy >= this.height ? 0 : this.value(yy * this.width + ((xx % this.width) + this.width) % this.width, hours);
    return (at(ix, iy) * (1 - a) + at(ix + 1, iy) * a) * (1 - b)
      + (at(ix, iy + 1) * (1 - a) + at(ix + 1, iy + 1) * a) * b;
  }
  stir(storm, env, dt, hours) {
    if (storm.kind === 'cloud' || storm.wind < 17) return;
    const cos = Math.max(.2, Math.cos(storm.lat * Math.PI / 180));
    const radius = Math.min(350, storm.radius * .75), sigma = radius * .48;
    const speed = Math.hypot(storm.u, storm.v), sign = storm.lat < 0 ? -1 : 1;
    // Stronger wind stress to the right of NH motion (left in SH).
    const offsetX = speed > 1 ? storm.v / speed * sigma * .3 * sign : 0;
    const offsetY = speed > 1 ? -storm.u / speed * sigma * .3 * sign : 0;
    const cx = (storm.lon - this.west) / this.step - .5, cy = (storm.lat - this.south) / this.step - .5;
    const rx = Math.ceil(radius / (111.2 * cos * this.step)), ry = Math.ceil(radius / (111.2 * this.step));
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(this.height - 1, Math.ceil(cy + ry)); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) * 111.2 * cos * this.step - offsetX, dy = (y - cy) * 111.2 * this.step - offsetY;
        const r2 = dx * dx + dy * dy;
        if (r2 > radius * radius) continue;
        const index = y * this.width + ((x % this.width) + this.width) % this.width;
        if (!this.land.has(index)) this.land.set(index, this.isLand(this.west + (x + .5) * this.step, this.south + (y + .5) * this.step));
        if (this.land.get(index)) continue;
        const cooling = .16 * (storm.wind / 55) ** 3 * 55 / (env.ohc + 30) * Math.exp(-r2 / (2 * sigma * sigma));
        const old = this.value(index, hours);
        this.cells.set(index, { cooling: Math.min(6, old + cooling * dt * (1 - old / 6)), hours });
      }
  }
  snapshot(hours) {
    const cells = [];
    for (const [index] of this.cells) {
      const cooling = this.value(index, hours);
      if (cooling < .005) { this.cells.delete(index); continue; }
      cells.push([index, cooling]);
    }
    return { west: this.west, south: this.south, step: this.step, width: this.width, height: this.height, hours, cells };
  }
}
