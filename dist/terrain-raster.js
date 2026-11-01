// Cache static coastline geometry with a guard band. Panning/following moves
// the same native-resolution raster; zoom, resize or new geometry rebuild it.
// Grid labels are deliberately NOT cached here: they stay viewport-anchored.
export class TerrainRaster {
  constructor(outlineOnly = false) {
    this.outlineOnly = outlineOnly;
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { alpha: outlineOnly });
    this.builds = 0;
  }
  draw(target, camera, width, height, ratio, land, coast, palette) {
    const pad = 128, anchor = this.anchor;
    let dx = anchor ? (anchor.x - camera.x) * camera.scale : Infinity;
    let dy = anchor ? (anchor.y - camera.y) * camera.scale : Infinity;
    const key = `${width}:${height}:${ratio}:${camera.scale}:${palette.sea}:${palette.land}:${palette.coast}`;
    if (this.key !== key || this.land !== land || this.coast !== coast || Math.abs(dx) > pad || Math.abs(dy) > pad) {
      const w = width + pad * 2, h = height + pad * 2, ctx = this.context;
      const pixelsW = Math.ceil(w * ratio), pixelsH = Math.ceil(h * ratio);
      if (this.canvas.width !== pixelsW || this.canvas.height !== pixelsH) {
        this.canvas.width = pixelsW; this.canvas.height = pixelsH;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (this.outlineOnly) ctx.clearRect(0, 0, w, h);
      else { ctx.fillStyle = palette.sea; ctx.fillRect(0, 0, w, h); }
      if (land) {
        ctx.save(); ctx.translate(w / 2 - camera.x * camera.scale, h / 2 - camera.y * camera.scale);
        ctx.scale(camera.scale, camera.scale);
        const circumference = Math.PI * 2;
        const first = Math.floor((camera.x - w / 2 / camera.scale + Math.PI) / circumference);
        const last = Math.floor((camera.x + w / 2 / camera.scale + Math.PI) / circumference);
        ctx.fillStyle = palette.land; ctx.strokeStyle = palette.coast;
        ctx.lineWidth = .7 / camera.scale; ctx.lineJoin = 'round';
        for (let world = first; world <= last; world++) {
          ctx.save(); ctx.translate(world * circumference, 0);
          if (!this.outlineOnly) ctx.fill(land, 'evenodd');
          ctx.stroke(coast); ctx.restore();
        }
        ctx.restore();
      }
      this.key = key; this.land = land; this.coast = coast;
      this.anchor = { ...camera }; this.builds++; dx = dy = 0;
    }
    // Explicit source crop avoids a full oversized-canvas transfer and ensures
    // all viewport pixels are covered at the guard-band boundary.
    target.drawImage(this.canvas, (pad - dx) * ratio, (pad - dy) * ratio,
      width * ratio, height * ratio, 0, 0, width, height);
  }
}
