export async function localBinary(raw:string,packed:string|undefined,signal:AbortSignal){
 const supportsGzip=typeof DecompressionStream!=='undefined';
 let r=await fetch(packed&&supportsGzip?packed:raw,{signal});
 if(r.status===404&&packed&&supportsGzip)r=await fetch(raw,{signal});
 if(!r.ok)throw new Error(`本地资产读取失败：${r.status}`);
 const data=await r.arrayBuffer(),header=new Uint8Array(data,0,Math.min(2,data.byteLength));
 if(header[0]===31&&header[1]===139){
  const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  const unpacked=await new Response(stream).arrayBuffer();signal.throwIfAborted();return unpacked;
 }
 signal.throwIfAborted();return data;
}
