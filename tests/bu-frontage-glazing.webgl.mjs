// Standalone shader smoke test against the development server. This synthetic
// pane checks GPU compilation only; it is not a campus visual acceptance shot.
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
const server=process.env.WORLD_BASE_URL?null:await createServer({
  server:{host:'127.0.0.1',port:5197,strictPort:true},optimizeDeps:{noDiscovery:true,entries:[],include:['three']},
  plugins:[{name:'bu-glazing-smoke-page',configureServer(s){s.middlewares.use((req,res,next)=>{
    if(req.url?.startsWith('/__bu-glazing-smoke.html')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>BU glazing shader test</title>');return;}next();
  });}}],
});
await server?.listen();
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage();
  await page.goto((process.env.WORLD_BASE_URL||'http://127.0.0.1:5197')+'/__bu-glazing-smoke.html',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const source=await fetch('/src/features/world/bu-frontage-glazing.ts').then(r=>r.text());
    const dependency=source.match(/from ["']([^"']+three[^"']*)["']/)?.[1];
    if(!dependency)throw new Error('Development server did not expose the glazing module');
    const T=await import(dependency);
    const {createBUFrontageGlazing}=await import('/src/features/world/bu-frontage-glazing.ts');
    const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(64,64);renderer.toneMapping=T.ACESFilmicToneMapping;
    const errors=[];renderer.debug.onShaderError=(gl,program,vs,fs)=>errors.push(gl.getProgramInfoLog(program),gl.getShaderInfoLog(vs),gl.getShaderInfoLog(fs));
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,1,.1,100);camera.position.set(0,-.9,4);camera.lookAt(0,0,0);
    scene.add(new T.HemisphereLight('#c2d8f2','#b6b5a3',1.75));const sun=new T.DirectionalLight('#fff3d9',2.65);sun.position.set(-95,115,135);scene.add(sun);
    const bytes=new Uint8Array(32*16*4);for(let y=0;y<16;y++)for(let x=0;x<32;x++){const i=(y*32+x)*4;bytes[i]=75+y*5;bytes[i+1]=115+y*4;bytes[i+2]=140+y*4;bytes[i+3]=255;}
    const texture=new T.DataTexture(bytes,32,16);texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;
    const skyMaterial=new T.ShaderMaterial({uniforms:{uSkyMap:{value:texture},uSkyReady:{value:1},uSkyTime:{value:0}}});
    const sky=new T.Mesh(new T.BoxGeometry(),skyMaterial);sky.name='Painted cloud sky';sky.visible=false;scene.add(sky);
    const geometry=new T.PlaneGeometry(3,3),target=new T.WebGLRenderTarget(64,64),pixels=new Uint8Array(64*64*4),reports=[];
    for(const mobile of [false,true])for(const variant of ['clear','light','dark']){
      const material=createBUFrontageGlazing({variant,mobile}),mesh=new T.Mesh(geometry,material);scene.add(mesh);
      renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,64,64,pixels);
      const i=(32*64+32)*4;reports.push({mobile,variant,pixel:[...pixels.slice(i,i+4)]});scene.remove(mesh);material.dispose();
    }
    target.dispose();geometry.dispose();sky.geometry.dispose();skyMaterial.dispose();texture.dispose();renderer.dispose();
    return {errors,reports};
  });
  if(result.errors.length||result.reports.some(r=>r.pixel[3]!==255||r.pixel.slice(0,3).every(v=>v===0)))throw new Error(JSON.stringify(result));
  console.log(JSON.stringify({status:'passed',...result}));
}finally{await browser.close();await server?.close();}
