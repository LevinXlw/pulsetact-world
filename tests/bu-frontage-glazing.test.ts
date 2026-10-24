import {describe,expect,it,vi} from 'vitest';
import {BoxGeometry,Mesh,Scene,ShaderLib,ShaderMaterial,Texture,UniformsUtils,type WebGLRenderer} from 'three';
import {buFrontageGlazingVariant,createBUFrontageGlazing} from '../src/features/world/bu-frontage-glazing';

const compile=(material:ReturnType<typeof createBUFrontageGlazing>)=>{
  const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:UniformsUtils.clone(ShaderLib.standard.uniforms)} as Parameters<typeof material.onBeforeCompile>[0];
  material.onBeforeCompile(shader,{} as WebGLRenderer);return shader;
};
const draw=(material:ReturnType<typeof createBUFrontageGlazing>,scene:Scene)=>material.onBeforeRender(...[{},scene,{}, {}, {}, {}] as Parameters<typeof material.onBeforeRender>);

describe('bounded BU frontage glazing',()=>{
  it('keeps direct-lighting PBR, restrained reflectance and exact scoped names on both tiers',()=>{
    for(const mobile of [false,true])for(const variant of ['clear','light','dark'] as const){
      const m=createBUFrontageGlazing({mobile,variant}),s=compile(m);
      expect(m.transparent).toBe(false);expect(m.opacity).toBe(1);expect(m.depthWrite).toBe(true);
      expect(m.metalness).toBeLessThan(.1);expect(m.roughness).toBeGreaterThan(.2);expect(m.emissive.getHex()).toBe(0);
      expect(buFrontageGlazingVariant(m.name)).toBe(variant);
      expect(s.fragmentShader).toContain('#include <lights_physical_fragment>');
      expect(s.fragmentShader).toContain('outgoingLight=mix(outgoingLight,buGlassReflection,buGlassAmount)');
      expect(s.fragmentShader).toContain('#include <fog_fragment>');
      expect(s.fragmentShader).not.toContain('diffuseColor.rgb=mix(diffuseColor.rgb,reflection');
      expect(s.uniforms.uBUFrontageReflectance.value).toBeLessThanOrEqual(.15);
      m.dispose();
    }
    for(const name of ['glass','BU district · glass','CDS glass','BU frontage glass · unknown'])expect(buFrontageGlazingVariant(name)).toBeUndefined();
  });
  it('borrows the displayed sky and its clock, releases references without disposing foreign resources',()=>{
    const texture=new Texture(),textureDispose=vi.spyOn(texture,'dispose'),scene=new Scene();
    const source=new ShaderMaterial({uniforms:{uSkyMap:{value:texture},uSkyReady:{value:1},uSkyTime:{value:17}}});
    const sky=new Mesh(new BoxGeometry(),source);sky.name='Painted cloud sky';scene.add(sky);
    const material=createBUFrontageGlazing(),shader=compile(material);draw(material,scene);
    expect(shader.uniforms.uBUFrontageSky.value).toBe(texture);expect(shader.uniforms.uBUFrontageSkyTime.value).toBe(17);
    source.uniforms.uSkyTime.value=93;draw(material,scene);expect(shader.uniforms.uBUFrontageSkyTime.value).toBe(93);
    scene.remove(sky);draw(material,scene);expect(shader.uniforms.uBUFrontageSky.value).toBeNull();
    material.dispose();material.dispose();expect(textureDispose).not.toHaveBeenCalled();
    source.dispose();sky.geometry.dispose();texture.dispose();
  });
  it('uses no panorama on phones and avoids doubling a real supplied IBL',()=>{
    const env=new Texture(),spy=vi.spyOn(env,'dispose'),scene=new Scene();
    const mobile=createBUFrontageGlazing({mobile:true}),ms=compile(mobile);draw(mobile,scene);
    expect(mobile.defines.BU_FRONTAGE_MOBILE).toBe(1);expect(ms.uniforms.uBUFrontageSkyReady.value).toBe(0);
    const standard=createBUFrontageGlazing({environment:env}),ss=compile(standard);draw(standard,scene);
    expect(ss.uniforms.uBUFrontageHasEnvironment.value).toBe(1);
    scene.environment=env;draw(mobile,scene);expect(ms.uniforms.uBUFrontageHasEnvironment.value).toBe(1);
    standard.dispose();mobile.dispose();expect(spy).not.toHaveBeenCalled();env.dispose();
  });
});
