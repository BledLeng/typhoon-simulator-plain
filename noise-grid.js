// Separable sampling of the unchanged seeded 64² forcing lattice. Coordinates
// and interpolation remain Float64; only repeated floor/hash work is hoisted.
export function noiseAxis(coordinates, period = 64) {
  const left = new Uint8Array(coordinates.length), right = new Uint8Array(coordinates.length);
  const weight = new Float64Array(coordinates.length);
  for (let i = 0; i < coordinates.length; i++) {
    const integer = Math.floor(coordinates[i]), fraction = coordinates[i] - integer;
    left[i] = ((integer % period + period) % period) & 63;
    right[i] = (((integer + 1) % period + period) % period) & 63;
    weight[i] = fraction * (fraction * (3 - 2 * fraction));
  }
  return {left, right, weight};
}

// A longitude revolution must contain a whole number of lattice cells. Both
// global and nested meshes use this same geographic forcing, even at ±180°.
export function longitudeNoiseAxis(longitudes, frequency, phase = 0) {
  const period = Math.max(1, Math.round(360 * frequency));
  return noiseAxis(Float64Array.from(longitudes, lon => lon * period / 360 + phase), period);
}

export function addNoiseRow(values, axis, y, scale, output, replace) {
  const integer = Math.floor(y), fraction = y - integer;
  const b = fraction * (fraction * (3 - 2 * fraction)), y0 = (integer & 63) * 64, y1 = ((integer + 1) & 63) * 64;
  const {left, right, weight} = axis;
  for (let x = 0; x < output.length; x++) {
    const x0 = left[x], x1 = right[x], a = weight[x];
    const value = ((values[y0 + x0] * (1 - a) + values[y0 + x1] * a) * (1 - b)
      + (values[y1 + x0] * (1 - a) + values[y1 + x1] * a) * b) * scale;
    output[x] = replace ? value : output[x] + value;
  }
}
