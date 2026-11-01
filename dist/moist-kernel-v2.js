// ABI v2: the solver and the WASM corrector share the cloud transport scratch slot.
// Optional compiled numerical hot loop. Browser/compile failure falls back to
// the reference JS solver, not a blank sky. Public algorithm stays in source.
let module;
const stateKeys=['vapor','water','temperature','cold','u','v','land','seaCooling','soilHeat','soilWater',
  'inflowAscent','coreSupport','lift','sink','dryMix','dryVapor','convection'];
const environmentKeys=['upperU','upperV','sst','thermalHumidity','activityLift','front','activitySector',
  'ambientLift','temperature','surfaceSaturation','targetVapor'];
const doubles=new Set([20,21,23,24,26]);

export async function loadCloudKernel(bytes) {
  if(!bytes) {
    const response=await fetch(new URL('./cloud-kernel.wasm?v=shared-deck-1',import.meta.url),{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error(`Cloud kernel HTTP ${response.status}`);
    bytes=await response.arrayBuffer();
  }
  module=await WebAssembly.compile(bytes);
}

export function makeCloudKernel(n,h) {
  if(!module)return null;
  try { return allocateCloudKernel(n,h); }
  catch { return null; } // Memory-constrained devices retain the JS path.
}

function allocateCloudKernel(n,h) {
  const {exports}=new WebAssembly.Instance(module,{env:{exp:Math.exp},math:{exp:Math.exp}});
  const heap=Number(exports.__heap_base.value),pointers=new Uint32Array(36),lengths=[];
  let end=heap+36*4;
  for(let i=0;i<36;i++) {
    end=Math.ceil(end/8)*8;pointers[i]=end;
    const length=i===29||i===30?h:n;lengths.push(length);
    end+=length*(doubles.has(i)?8:4);
  }
  const pages=Math.ceil(end/65536)-exports.memory.buffer.byteLength/65536;
  if(pages>0)exports.memory.grow(pages);
  const addresses = new Uint32Array(exports.memory.buffer,heap,36);
  addresses.set(pointers);
  const arrays=Array.from(pointers,(offset,i)=>new (doubles.has(i)?Float64Array:Float32Array)(exports.memory.buffer,offset,lengths[i]));
  return {step(field,dt,transported) {
    const sources=[...stateKeys.map(key=>field[key]),...environmentKeys.map(key=>field.envFields[key]),
      transported,field.kmx,field.kmy,...field.next,field.convectionNext];
    const memory=exports.memory.buffer;
    const used=new Set(sources.filter(source=>source?.buffer===memory).map(source=>source.byteOffset));
    if(!transported){addresses[28]=arrays[28].byteOffset;used.add(addresses[28]);}
    for(let i=0;i<sources.length;i++) {
      const source=sources[i];if(!source)continue;
      if(source.buffer===memory){addresses[i]=source.byteOffset;continue;}
      // Adopt typed state once. Ping-pong swaps only change the address table;
      // moving/regridded nests can introduce a new array, so select an unused
      // same-type slot instead of overwriting a live swapped field.
      const compatible=slot=>!used.has(slot.byteOffset)&&slot.length===lengths[i]
        && slot.BYTES_PER_ELEMENT===(doubles.has(i)?8:4);
      const target=compatible(arrays[i])?arrays[i]:arrays.find(compatible);
      if(!target)throw new Error('Cloud kernel state alias');
      target.set(source);addresses[i]=target.byteOffset;used.add(target.byteOffset);
      if(i<17&&i!==6)field[stateKeys[i]]=target;
      else if(i>=17&&i<28)field.envFields[environmentKeys[i-17]]=target;
      else if(i===29)field.kmx=target;
      else if(i===30)field.kmy=target;
      else if(i>=31&&i<35)field.next[i-31]=target;
      else if(i===35)field.convectionNext=target;
    }
    const mode=transported ? 1 : field.secondOrderTransport===false ? 0 : 2;
    exports.step(field.width,field.height,Number(field.periodic),mode,dt,heap);
  }};
}
