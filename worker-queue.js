// Serialize worker messages behind asynchronous prerequisites without dropping
// transfers posted before WASM or another optional resource finishes loading.
export function queueWorkerMessages(ready, process, onError) {
  let serial = Promise.resolve();
  const receive = message => {
    serial = serial.then(() => ready).then(() => process(message)).catch(onError);
  };
  receive.idle = () => serial;
  return receive;
}
