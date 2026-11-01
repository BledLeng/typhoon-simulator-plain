import { CloudCompositor } from './cloud-compositor.js?v=global-39';

function surface(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Both inputs have the same dimensions. Interpolate premultiplied colors;
// source-over would thin the cloud halfway through a transition.
function mix(out, a, b, t) {
  const ctx = out.getContext('2d');
  ctx.globalCompositeOperation = 'copy'; ctx.globalAlpha = 1 - t;
  ctx.drawImage(a, 0, 0);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = t;
  ctx.drawImage(b, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

export class CloudPresentation {
  constructor() {
    this.fromView = new CloudCompositor(); this.toView = new CloudCompositor();
    this.serial = 0; this.frameId = 0; this.alpha = 1; this.lastPaint = -Infinity;
  }
  accept(frame, now) {
    // Workers only publish whole-world frames. Keep the transferred bitmap
    // as the source instead of decoding it onto another full-world canvas.
    let image = frame.bitmap;
    if (!image) {
      image = surface(frame.width,frame.height);
      image.getContext('2d').putImageData(new ImageData(
        new Uint8ClampedArray(frame.buffer),frame.width,frame.height),0,0);
    }
    const a = this.previous, b = this.current;
    const transition = b && frame.layer === this.layer &&
      image.width === b.width && image.height === b.height;
    let from = image, fromId = this.frameId+1;
    if (transition) {
      if (this.alpha >= 1 || a === b) {
        from = b; fromId = this.frameId; [this.fromView,this.toView] = [this.toView,this.fromView];
      } else if (this.alpha <= 0) {
        from = a; fromId = this.fromId;
      } else {
        // Interrupted transitions must also remain continuous if the camera moves.
        // Bake an endpoint in world space just once, not at every display tick.
        from = this.spare;
        if (!from || from === a || from.width !== b.width || from.height !== b.height)
          from = surface(b.width,b.height);
        mix(from,a,b,this.alpha); fromId = -this.frameId;
      }
    }
    this.spare = a && !a.close && a !== from && a.width === image.width && a.height === image.height ? a : null;
    if (a !== from) a?.close?.();
    if (b !== a && b !== from) b?.close?.();
    this.frameId++; this.fromId = fromId;
    this.previous = from; this.current = image; this.layer = frame.layer;
    this.duration = transition ? Math.min(1000,Math.max(1000/24,now-this.started)) : 0;
    this.started = now; this.lastPaint = -Infinity; this.paint(now,true);
  }
  paint(now, force = false) {
    const dt = 1000/24;
    if (!this.current || (!force && (!this.active || now-this.lastPaint < dt))) return false;
    this.lastPaint = !force && Number.isFinite(this.lastPaint) ? now-((now-this.lastPaint)%dt) : now;
    this.alpha = this.duration ? Math.min(1, Math.max(0,(now-this.started)/this.duration)) : 1;
    this.active = this.alpha < 1; this.serial++; return true;
  }
  draw(ctx, bounds, width, height) {
    const dpr = Math.min(2,Math.max(1,ctx.canvas.width/width));
    const view = (compositor,image,id) => compositor.resolveWorlds(
      bounds.map(box => [{ ...box, image }]),width,height,dpr,id);
    const t = this.alpha;
    if (t <= 0 || t >= 1 || this.previous === this.current) {
      const image = t <= 0 ? view(this.fromView,this.previous,this.fromId) : view(this.toView,this.current,this.frameId);
      ctx.drawImage(image,0,0,width,height);
      return;
    }
    const a = view(this.fromView,this.previous,this.fromId), b = view(this.toView,this.current,this.frameId);
    if (!this.output || this.output.width !== b.width || this.output.height !== b.height)
      this.output = surface(b.width,b.height);
    mix(this.output,a,b,t); ctx.drawImage(this.output,0,0,width,height);
  }
}
