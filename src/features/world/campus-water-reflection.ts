import {HalfFloatType,Matrix4,Mesh,PerspectiveCamera,Plane,Vector3,Vector4,WebGLRenderTarget,type Camera,type Scene,type Texture,type WebGLRenderer} from 'three';

type ReflectiveWater={setPlanarReflection:(value:{texture:Texture;matrix:Matrix4;strength?:number}|null)=>void};
const rendering=new WeakSet<WebGLRenderer>();

/** One bounded reflection of the Charles, allocated only when desktop high
 * quality actually sees water. Phone materials never install this pass. */
export function attachCampusWaterReflection(water:Mesh,material:ReflectiveWater,height:number){
  const camera=new PerspectiveCamera(),matrix=new Matrix4(),plane=new Plane(new Vector3(0,1,0),-height);
  const clip=new Vector4(),q=new Vector4(),eye=new Vector3(),look=new Vector3(),rotation=new Matrix4();
  const oldBefore=water.onBeforeRender;
  let buffer:WebGLRenderTarget|undefined,enabled=true,disposed=false,lastTime=-Infinity,frames=0;
  const hide:Mesh[]=[];
  const release=()=>{material.setPlanarReflection(null);buffer?.dispose();buffer=undefined;lastTime=-Infinity;};
  const render=(renderer:WebGLRenderer,scene:Scene,source:Camera)=>{
    if(!enabled||disposed||rendering.has(renderer)||!(source as PerspectiveCamera).isPerspectiveCamera)return;
    eye.setFromMatrixPosition(source.matrixWorld);
    if(eye.y<=height+.02)return;
    const now=performance.now();
    if(buffer&&now-lastTime<1000/12)return;
    if(!buffer){
      buffer=new WebGLRenderTarget(768,384,{type:HalfFloatType,depthBuffer:true,stencilBuffer:false});
      buffer.texture.name='Charles bounded scene reflection';buffer.texture.generateMipmaps=false;
    }
    camera.position.copy(eye);camera.position.y=2*height-eye.y;
    rotation.extractRotation(source.matrixWorld);
    look.set(0,0,-1).applyMatrix4(rotation).add(eye);look.y=2*height-look.y;
    camera.up.set(0,1,0).applyMatrix4(rotation);camera.up.y*=-1;
    camera.lookAt(look);camera.far=(source as PerspectiveCamera).far;camera.near=(source as PerspectiveCamera).near;
    camera.updateMatrixWorld();camera.projectionMatrix.copy(source.projectionMatrix);
    matrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1)
      .multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    // Oblique near plane clips land below the water, including foundations.
    const reflectedPlane=plane.clone().applyMatrix4(camera.matrixWorldInverse);
    clip.set(reflectedPlane.normal.x,reflectedPlane.normal.y,reflectedPlane.normal.z,reflectedPlane.constant);
    const p=camera.projectionMatrix.elements;
    q.set((Math.sign(clip.x)+p[8])/p[0],(Math.sign(clip.y)+p[9])/p[5],-1,(1+p[10])/p[14]);
    clip.multiplyScalar(2/clip.dot(q));p[2]=clip.x;p[6]=clip.y;p[10]=clip.z+1-.001;p[14]=clip.w;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    const previousTarget=renderer.getRenderTarget(),cubeFace=renderer.getActiveCubeFace(),mipmap=renderer.getActiveMipmapLevel();
    const xr=renderer.xr.enabled,shadows=renderer.shadowMap.autoUpdate;
    hide.length=0;
    scene.traverse(object=>{
      if(object instanceof Mesh&&object.visible&&(object===water||(Array.isArray(object.material)?object.material:[object.material]).some(m=>m.userData.campusWater))){hide.push(object);object.visible=false;}
    });
    rendering.add(renderer);
    try{
      renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;
      renderer.setRenderTarget(buffer);renderer.state.buffers.depth.setMask(true);
      if(!renderer.autoClear)renderer.clear();
      renderer.render(scene,camera);
      material.setPlanarReflection({texture:buffer.texture,matrix,strength:.85});
      frames++;lastTime=now;
    }finally{
      hide.forEach(mesh=>{mesh.visible=true;});hide.length=0;
      renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadows;
      renderer.setRenderTarget(previousTarget,cubeFace,mipmap);
      const viewport=(source as Camera&{viewport?:Vector4}).viewport;
      if(viewport)renderer.state.viewport(viewport);
      rendering.delete(renderer);
    }
  };
  water.onBeforeRender=function(renderer,scene,source,...rest){oldBefore.call(this,renderer,scene,source,...rest);render(renderer,scene,source);};
  const dispose=()=>{if(disposed)return;disposed=true;water.onBeforeRender=oldBefore;release();};
  return {setQuality:(low:boolean)=>{enabled=!low;if(low)release();},dispose,get frames(){return frames;},get allocated(){return !!buffer;}};
}
