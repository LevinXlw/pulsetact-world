import {describe,expect,it} from 'vitest';
import {Matrix4,ShaderLib,Texture,Vector2,Vector3,WebGLRenderTarget,type WebGLRenderer} from 'three';
import {createCampusWaterMaterial,createCampusWaterShoreField} from '../src/features/world/campus-water';

describe('shared campus water',()=>{
  it('keeps one live time uniform through runtime quality and reflection changes',()=>{
    const time={value:2},material=createCampusWaterMaterial({time,quality:'mobile'});
    const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}};
    material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0],{} as WebGLRenderer);
    const uniforms=shader.uniforms as Record<string,{value:unknown}>;
    expect(uniforms.uCampusWaterTime).toBe(time);
    time.value=8;expect(uniforms.uCampusWaterTime.value).toBe(8);
    expect(material.userData.campusWater).toBe(true);
    expect(material.transparent).toBe(false);
    expect(material.map).toBeNull();expect(material.normalMap).toBeNull();
    expect(material.displacementMap).toBeNull();

    const texture=new Texture(),matrix=new Matrix4();
    material.setPlanarReflection({texture,matrix});
    expect(material.defines.CAMPUS_WATER_PLANAR).toBeUndefined();
    expect(uniforms.uCampusWaterReflectionMatrix.value).toBe(matrix);
    matrix.makeTranslation(1,2,3);
    expect((uniforms.uCampusWaterReflectionMatrix.value as Matrix4).elements[12]).toBe(1);
    material.setQuality('mobile-hd');
    expect(material.defines.CAMPUS_WATER_PLANAR).toBeUndefined();
    const mobileKey=material.customProgramCacheKey();
    material.setQuality('desktop');
    expect(material.defines.CAMPUS_WATER_PLANAR).toBe(1);
    expect(material.customProgramCacheKey()).not.toBe(mobileKey);
    material.setPlanarReflection(null);
    expect(material.defines.CAMPUS_WATER_PLANAR).toBeUndefined();
    expect(uniforms.uCampusWaterReflection.value).toBeNull();
    material.dispose();texture.dispose();
  });

  it('injects into the installed Three Standard shader before tone mapping without moving its vertices',()=>{
    const material=createCampusWaterMaterial({sunDirection:new Vector3(0,2,2)});
    const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}};
    material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0],{} as WebGLRenderer);
    const fragment=shader.fragmentShader;
    expect(fragment).toContain('#include <lights_fragment_begin>');
    expect(fragment).toContain('#include <fog_fragment>');
    expect(fragment.indexOf('cwWaterLight')).toBeGreaterThan(fragment.indexOf('vec3 totalSpecular ='));
    expect(fragment.indexOf('cwWaterLight')).toBeLessThan(fragment.indexOf('#include <tonemapping_fragment>'));
    expect(fragment.indexOf('cwWorldNormal =')).toBeLessThan(fragment.indexOf('#include <lights_physical_fragment>'));
    expect(shader.vertexShader).toContain('#include <project_vertex>');
    expect(shader.vertexShader).not.toMatch(/transformed\s*\+=|transformed\s*=|position\s*\+=/);
    expect(fragment).toContain('footprint*scale');
    expect(fragment).toContain('cwHorizontal');
    expect(fragment).not.toContain('pow(max(0.,streak)');
    material.dispose();
  });

  it('adapts the reflection filter to its actual render target and subsequent resize',()=>{
    const material=createCampusWaterMaterial(),target=new WebGLRenderTarget(768,384);
    const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}};
    material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0],{} as WebGLRenderer);
    const uniforms=shader.uniforms as Record<string,{value:unknown}>;
    material.setPlanarReflection({texture:target.texture,matrix:new Matrix4()});
    const texel=uniforms.uCampusWaterReflectionTexel.value as Vector2;
    expect(texel.x).toBeCloseTo(1/768,10);expect(texel.y).toBeCloseTo(1/384,10);
    target.setSize(512,256);
    material.setPlanarReflection({texture:target.texture,matrix:new Matrix4()});
    expect(texel.x).toBeCloseTo(1/512,10);expect(texel.y).toBeCloseTo(1/256,10);
    material.setPlanarReflection(null);expect(texel.toArray()).toEqual([0,0]);
    material.dispose();target.dispose();
  });

  it('encodes metres to the supplied open banks, never closing a shore across open water',()=>{
    const field=createCampusWaterShoreField([[[0,0],[8,0],[8,8]]],[0,0,8,8],{resolution:[4,4],maxDistance:4});
    const data=field.texture.image.data as Uint8Array;
    // Texel centres are (1,1),(3,1)...; a false closing diagonal would make
    // the (3,3) texel zero, whereas the nearest actual bank is three metres away.
    expect(data[1*4+1]).toBe(Math.round(3/4*255));
    expect(data[0]).toBe(Math.round(1/4*255));
    expect(data[3*4]).toBe(255);
    expect(field.texture.generateMipmaps).toBe(false);
    field.texture.dispose();
  });

  it('has bounded shared shore storage and handles empty or degenerate bank input',()=>{
    const empty=createCampusWaterShoreField([],[-100,0,100,200]);
    expect(empty.texture.image.data.byteLength).toBe(256*128);
    expect(Array.from(empty.texture.image.data as Uint8Array).every(value=>value===255)).toBe(true);
    const degenerate=createCampusWaterShoreField([[[3,4],[3,4]]],[0,0,8,8],{resolution:[2,2]});
    expect(Array.from(degenerate.texture.image.data as Uint8Array)).toEqual([255,255,255,255]);
    expect(()=>createCampusWaterShoreField([], [0,0,0,8])).toThrow();
    expect(()=>createCampusWaterShoreField([], [0,0,8,8],{resolution:[1024,1024]})).toThrow();
    expect(()=>createCampusWaterShoreField([[[NaN,0],[0,1]]],[0,0,8,8])).toThrow();
    empty.texture.dispose();degenerate.texture.dispose();
  });
});
