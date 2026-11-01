// Moist-layer mixing-ratio supply (g/kg/h), not a calibrated W/m² flux product.
// Applied every numerical step to vapor. Condensation/transport, never this
// boundary flux directly, determines the displayed cloud water.
import {flaq_vaporSupply} from './marine.generated.js';
export function surfaceVaporSupply(surfaceSaturation, vapor, windSpeed, wetSurface = 1, ocean = true) {
  return flaq_vaporSupply(surfaceSaturation,vapor,windSpeed,wetSurface,Number(ocean));
}
