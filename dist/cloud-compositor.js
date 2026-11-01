// Premultiplied replacement: parent*(1-weight) + detail*weight. Resolve in the
// map's Canvas2D pipeline, avoiding a WebGL -> Canvas2D -> glass WebGL round trip.
// A feathered mask reaches zero BEFORE each tile edge; never cut rectangular holes.
export class CloudCompositor {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
    this.tiles = [];
    this.worldStrip = document.createElement('canvas');
  }
  prepareWorlds(image, count, revision) {
    if (this.worldSource === image && this.worldCount === count && this.worldRevision === revision) return this.worldStrip;
    const w = image.width, h = image.height, strip = this.worldStrip;
    if (strip.width !== w * count + 2 || strip.height !== h) { strip.width = w * count + 2; strip.height = h; }
    const c = strip.getContext('2d');
    c.clearRect(0, 0, strip.width, h);
    c.drawImage(image, w - 1, 0, 1, h, 0, 0, 1, h);
    for (let i = 0; i < count; i++) c.drawImage(image, 1 + i * w, 0);
    c.drawImage(image, 0, 0, 1, h, 1 + count * w, 0, 1, h);
    this.worldSource = image; this.worldCount = count; this.worldRevision = revision;
    return strip;
  }
  prepare(image, index, revision) {
    let tile = this.tiles[index];
    if (tile?.image === image && tile.revision === revision) return tile;
    const width = image.width, height = image.height;
    if (!tile || tile.mask.width !== width || tile.mask.height !== height) {
      const mask = document.createElement('canvas'), ink = document.createElement('canvas');
      mask.width = ink.width = width; mask.height = ink.height = height;
      const ctx = mask.getContext('2d'), pixels = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const radius = Math.hypot((x + .5) / width * 2 - 1, (y + .5) / height * 2 - 1);
        const t = Math.min(1, Math.max(0, (radius - .80) / .16));
        pixels.data[(y * width + x) * 4 + 3] = Math.round(255 * (1 - t * t * (3 - 2 * t)));
      }
      ctx.putImageData(pixels, 0, 0);
      tile = this.tiles[index] = { mask, ink };
    }
    const ctx = tile.ink.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(image, 0, 0);
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(tile.mask, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    tile.image = image; tile.revision = revision;
    return tile;
  }
  draw(context, layers, width, height, revision) {
    this.drawWorlds(context, [layers], width, height, revision);
  }
  drawWorlds(context, worlds, width, height, revision) {
    const dpr = Math.min(2, Math.max(1, context.canvas.width / width));
    context.drawImage(this.resolveWorlds(worlds, width, height, dpr, revision), 0, 0, width, height);
  }
  resolveWorlds(worlds, width, height, dpr, revision) {
    const w = Math.ceil(width * dpr), h = Math.ceil(height * dpr), ctx = this.context;
    // Camera and storm labels can redraw between cloud presentations. Reuse the
    // viewport ONLY while every sampled image, projected bound and scale matches.
    const layers = worlds.flat(), last = this.layout;
    if (revision !== undefined && revision === this.revision && last?.length === layers.length &&
        this.viewWidth === width && this.viewHeight === height && this.dpr === dpr &&
        this.worldCountCached === worlds.length && layers.every((l,i)=>{
          const a=last[i];return a.image===l.image && a.x===l.a.x && a.y===l.a.y && a.r===l.b.x && a.b===l.b.y;
        })) {
      return this.canvas;
    }
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const draw = (image, layer) => ctx.drawImage(image, layer.a.x, layer.a.y, layer.b.x - layer.a.x, layer.b.y - layer.a.y);
    // Repeat the world inside ONE composition, not a full viewport clear and
    // copy for every date-line copy. Detail can cross that seam continuously.
    ctx.globalCompositeOperation = 'source-over';
    if (worlds.length) {
      const first = worlds[0][0], last = worlds.at(-1)[0];
      const pixelWidth = (first.b.x - first.a.x) / first.image.width;
      // One bilinear sampling domain across the date line. Independent draws
      // clamp each texture edge and can leave a subpixel vertical seam.
      if (worlds.length === 1 && first.a.x < -2 && first.b.x > width + 2) {
        draw(first.image, first);
      } else {
        const strip = this.prepareWorlds(first.image, worlds.length, revision);
        ctx.drawImage(strip, first.a.x - pixelWidth, first.a.y,
          last.b.x - first.a.x + pixelWidth * 2, first.b.y - first.a.y);
      }
    }
    for (const layers of worlds) for (let i = 1; i < layers.length && i < 4; i++) {
      const layer = layers[i];
      if (layer.b.x <= 0 || layer.a.x >= width || layer.b.y <= 0 || layer.a.y >= height) continue;
      const tile = this.prepare(layer.image, i - 1, revision);
      ctx.globalCompositeOperation = 'destination-out'; draw(tile.mask, layer);
      ctx.globalCompositeOperation = 'lighter'; draw(tile.ink, layer);
    }
    ctx.globalCompositeOperation = 'source-over'; this.revision = revision;
    this.layout = layers.map(l=>({image:l.image,x:l.a.x,y:l.a.y,r:l.b.x,b:l.b.y}));
    this.viewWidth=width;this.viewHeight=height;this.dpr=dpr;this.worldCountCached=worlds.length;
    return this.canvas;
  }
}
