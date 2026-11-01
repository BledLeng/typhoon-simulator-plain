// Keep the same Runtime texture and sampling settings while a map canvas keeps
// its size. Reallocating texture storage on every map frame is unnecessary.
export function uploadMapTexture(renderer, source, revision) {
  const name = 'mapSource', key = `map:${revision}`;
  let entry = renderer.textures.get(name);
  if (entry?.url === key) return false;
  if (!entry || entry.mapWidth !== source.width || entry.mapHeight !== source.height) {
    renderer.upload(name, source, key);
    entry = renderer.textures.get(name);
    entry.mapWidth = source.width; entry.mapHeight = source.height;
  } else {
    const gl = renderer.gl;
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    entry.url = key;
  }
  return true;
}
