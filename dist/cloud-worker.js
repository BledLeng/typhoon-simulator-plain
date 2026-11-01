import { MoistAtmosphere } from './cloud-field.js?v=global-39';
import { CloudDetails } from './cloud-detail.js?v=global-39';
import { CLOUD_STEP_HOURS as STEP_HOURS } from './cloud-clock.js';
import { isCloudProduct } from './cloud-products.js?v=global-39';
import { pressureRange } from './pressure-field.js';
import { loadCloudKernel } from './moist-kernel-v2.js';
import { WorldCloudObserver } from './world-cloud-observer.js?v=global-39';
import { CpuWorldObserver } from './world-cloud-reference.js?v=global-39';
import { queueWorkerMessages } from './worker-queue.js?v=global-39';
let field, details, observer, lastCandidates = -Infinity;
function receive({ data }) {
  if (data.type === 'init') {
    field = new MoistAtmosphere(data.seed, data.width, data.height, new Uint8Array(data.land));
    details = new CloudDetails(field);
    observer = WorldCloudObserver.create(field) || new CpuWorldObserver(field);
    return;
  }
  try {
    if (!field) throw new Error('Atmosphere was not initialized');
    if (data.type === 'inspect') {
      self.postMessage({ inspectionOnly: true, inspection: field.inspect(data.probe) });
      return;
    }
    const started = performance.now();
    field.setOcean(data.ocean);
    // The solver clock is independent of monitor refresh. Repeated tiny
    // bilinear transports were both expensive and numerically diffusive.
    const steps = Math.floor((Math.max(0, data.hours - field.time) + 1e-8) / STEP_HOURS);
    field.advance(steps * STEP_HOURS, data.env, data.systems);
    // Presentation interpolates completed numerical states at 24 Hz on its
    // own clock, so a costly solver step cannot freeze the displayed clouds.
    const blend = 1;
    details.update(data.systems, data.env, data.view, data.selectedId);
    // Nests feed atmosphere and core diagnostics only. Satellite products
    // publish one complete globe; never send or overlay a per-storm picture.
    let bitmap,observed;
    if(observer)try{
      observer.update(field,data.systems,details.patches);
      if(isCloudProduct(data.layer)){
        if(observer.image)bitmap=observer.image(data.layer);else observed=observer.pixels(data.layer);
      }
    }catch(error){
      if(!observer.image)throw error;
      console.warn('Global observation CPU fallback:',String(error));observer=new CpuWorldObserver(field);observer.update(field,data.systems,details.patches);
      if(isCloudProduct(data.layer))observed=observer.pixels(data.layer);
    }
    const pixels=bitmap?null:(observed||field.pixels(data.layer,blend));
    const candidates = field.time - lastCandidates >= 6 ? field.candidates(data.systems) : [];
    if (field.time - lastCandidates >= 6) lastCandidates = field.time;
    self.postMessage({ width: bitmap?.width ?? (observed?observer.width:field.width), height: bitmap?.height ?? (observed?observer.height:field.height),
      ...(bitmap ? {bitmap} : {buffer:pixels.buffer}), observation:observer.image?'global-gpu':'global-cpu',
      hours: data.hours, fieldHours: field.time, seasonDay:field.seasonDay, patches:[], workMs: performance.now() - started,
      kernel: field.kernel ? 'wasm-f64' : 'js-reference',
      pressureRange: data.layer === 'pressure' ? pressureRange(data.systems) : null,
      diagnostics: details.diagnostics(data.systems), candidates,
      inspection: field.inspect(data.probe), layer: data.layer }, [bitmap || pixels.buffer]);
  } catch (error) { self.postMessage({ error: String(error) }); }
}

// Install the message handler synchronously. A module worker may receive its
// transferred land mask while WASM is compiling; top-level await here used to
// leave `onmessage` unset and silently lose init + the first cloud solve.
const kernelReady = typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
  ? loadCloudKernel().catch(error => {
    console.warn('Cloud kernel unavailable; using reference solver:', String(error));
  })
  : Promise.resolve();
self.onmessage = queueWorkerMessages(kernelReady, receive,
  error => self.postMessage({ error: String(error) }));
