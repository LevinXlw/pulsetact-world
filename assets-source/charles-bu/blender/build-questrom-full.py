"""Build the complete Questrom PBR exterior with bounded entrance refinement.

Run Blender --background --python-exit-code 1 --python build-questrom-full.py.
No downloads/rebake and no changes to the previous CDS/sample assets or runtime.
"""
from __future__ import annotations

import hashlib
import importlib
import json
from pathlib import Path
import struct
import sys
import time

import bpy

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
WORK=HERE/"questrom"
sys.path.insert(0,str(HERE))
sys.path.insert(0,str(WORK))
shared=importlib.import_module("build-cds-full")
pipeline=importlib.import_module("build-samples")
from refine_questrom import remove_old_handles,build_details,wrap_entry_bases,verify_entry_base_rays


def main():
    source=WORK/"input/questrom-full.glb"
    destination=REPO/"public/assets/bu-questrom/questrom-full.glb"
    source_manifest=json.loads((WORK/"input/manifest.json").read_text(encoding="utf-8"))
    previous=[HERE/"full/cds-full.blend",HERE/"full/cds-mobile-source.glb",REPO/"public/assets/bu-cds/cds-full.glb",HERE/"cds-ground.blend",HERE/"pass2/cds-ground.blend",HERE/"refine_cds.py"]
    unchanged={str(path):shared.digest(path) for path in previous}
    source_hash=shared.digest(source)
    if source_hash!=source_manifest["sha256"]:raise RuntimeError("Questrom input hash differs from its source manifest")
    pipeline.clear_objects()
    bpy.ops.import_scene.gltf(filepath=str(source.resolve()))
    originals=shared.meshes()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in originals:obj.select_set(True)
    bpy.context.view_layer.objects.active=originals[0]
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    bpy.context.view_layer.update()
    before=pipeline.geometry_stats(originals)
    if before["triangles"]!=source_manifest["triangles"] or before["blenderBoundsMetres"]["max"][2]<50:raise RuntimeError("Expected the complete source Questrom exterior")
    print("QUESTROM_BASELINE "+json.dumps(before),flush=True)
    protected={o.name:shared.surface_digest(o) for o in originals if o.get("ground") or any("glass" in s.material.name.lower() for s in o.material_slots if s.material)}
    upper={o.name:shared.surface_counter(o,min_height=7.5) for o in originals}
    base_wrap=wrap_entry_bases(originals)
    remove,handle_report=remove_old_handles(originals)
    # Prioritize entry-level pieces instead of indiscriminately bevelling the
    # hundreds of upper windows. Exactly selected source faces alone change.
    choices=[]
    for obj in originals:
        if obj.name in protected or not all(pipeline.family_for(s.material.name) in ("metal","stone") for s in obj.material_slots if s.material):continue
        for ids in shared.logical_components(obj,remove.get(obj.name,set())):
            points=[obj.matrix_world@obj.data.vertices[i].co for j in ids for i in obj.data.polygons[j].vertices]
            b=shared.bounds(points)
            if b["max"][2]>7.5 or b["min"][2]<-.01:continue
            center=[(b["min"][i]+b["max"][i])/2 for i in range(3)]
            priority=(center[0]-7)**2+(center[1]+20)**2
            choices.append((priority,obj,ids))
    choices.sort(key=lambda item:item[0])
    bevels,bevel_report,bevel_triangles={},[],0
    for _,obj,ids in choices:
        if len(bevel_report)>=48:break
        part=shared.bevel_component(obj,ids)
        if part and bevel_triangles+part["addedTriangles"]<=1800:
            bevels.setdefault(obj.name,[]).append(part)
            bevel_triangles+=part["addedTriangles"]
            bevel_report.append({"object":obj.name,**{k:part[k] for k in ("boundsBlender","widthMetres","addedTriangles")}})
    for obj in originals:
        shared.rebuild_selected(obj,remove.get(obj.name,set()),bevels.get(obj.name,[]))
        if upper[obj.name]!=shared.surface_counter(obj,min_height=7.5):raise RuntimeError("Upper-storey source geometry changed")
        if obj.name in protected and shared.surface_digest(obj)!=protected[obj.name]:raise RuntimeError("Protected glazing or source terrain changed")
    base_wrap["sideRayChecks"]=verify_entry_base_rays(originals)
    textures={family:{kind:HERE/"textures"/f"{family}-{kind}.png" for kind in ("basecolor","normal","orm")} for family in pipeline.TILES}
    if any(not path.is_file() for entries in textures.values() for path in entries.values()):raise RuntimeError("Missing reviewed Cycles tile; no automatic rebake")
    # The photographed stone is broad dressed panelwork. Its modeled seams stay
    # in the source; reuse continuous mineral microtexture instead of painting
    # extra 700x350 mm masonry joints across the canopy and every large panel.
    finish_textures={**textures,"stone":textures["concrete"]}
    cache={}
    for obj in originals:
        for slot in obj.material_slots:
            old=slot.material;key=old.name.split(".")[0]
            if key not in cache:
                cache[key]=pipeline.finish_material(old,finish_textures,"cds-ground")
                material=cache[key]
                material["bu_building"]="questrom"
                if material["bu_texture_family"]=="stone":material["bu_baked_tile_family"]="concrete"
                if key=="frame":
                    material.node_tree.nodes["Exportable PBR"].inputs["Metallic"].default_value=.55
                    material["bu_finish_note"]="Moderately reflective entry/window metal; original tint retained"
            slot.material=cache[key]
        pipeline.metre_uv(obj)
    new_objects,detail=build_details(originals,cache)
    for obj in new_objects:pipeline.metre_uv(obj)
    bpy.context.view_layer.update()
    objects=originals+new_objects
    after=pipeline.geometry_stats(objects)
    expansion=max(0,*(before["blenderBoundsMetres"]["min"][i]-after["blenderBoundsMetres"]["min"][i] for i in range(3)),*(after["blenderBoundsMetres"]["max"][i]-before["blenderBoundsMetres"]["max"][i] for i in range(3)))
    if expansion>.001 or after["triangles"]-before["triangles"]>=10000:raise RuntimeError("Questrom envelope or mobile incremental geometry budget exceeded")
    materials=list(cache.values())
    for material in materials:
        tree=material.node_tree;image,bsdf=tree.nodes.get("BU basecolor"),tree.nodes.get("Exportable PBR")
        if image:tree.links.new(image.outputs["Color"],bsdf.inputs["Base Color"])
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    destination.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(destination.resolve()),export_format="GLB",use_selection=True,export_apply=True,export_texcoords=True,export_normals=True,export_tangents=True,export_materials="EXPORT",export_image_format="AUTO",export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_yup=True)
    document,repairs=pipeline.patch_base_tints(destination,materials)
    primitives=sum(len(m["primitives"]) for m in document["meshes"])
    if primitives>20 or destination.stat().st_size>=10*1024*1024:raise RuntimeError("Questrom exceeds 20 primitives / 10 MiB")
    mobile=shared.texture_free_source(destination,WORK/"questrom-mobile-source.glb")
    # Reuse the packer without editing the prior CDS pipeline; correct its
    # descriptive asset metadata before recording the Questrom source hash.
    mobile_path=WORK/"questrom-mobile-source.glb"
    data=mobile_path.read_bytes();json_size=struct.unpack_from("<I",data,12)[0]
    mobile_doc=json.loads(data[20:20+json_size]);remainder=data[20+json_size:]
    mobile_doc["asset"]["extras"]["purpose"]="Texture-free offline mobile bake source; identical complete Questrom geometry and PBR base tints."
    encoded=json.dumps(mobile_doc,separators=(",",":"),ensure_ascii=True).encode();encoded+=b" "*((-len(encoded))%4)
    mobile_path.write_bytes(struct.pack("<III",0x46546C67,2,20+len(encoded)+len(remainder))+struct.pack("<II",len(encoded),0x4E4F534A)+encoded+remainder)
    mobile.update({"sha256":shared.digest(mobile_path),"bytes":mobile_path.stat().st_size})
    for material in materials:
        tree=material.node_tree;multiply,bsdf=tree.nodes.get("Original building colour"),tree.nodes.get("Exportable PBR")
        if multiply:tree.links.new(multiply.outputs[0],bsdf.inputs["Base Color"])
        for node in tree.nodes:
            if node.type=="TEX_IMAGE" and node.image:node.image.pack()
    blend=WORK/"questrom-full.blend"
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend.resolve()),check_existing=False)
    for path,expected in unchanged.items():
        if shared.digest(Path(path))!=expected:raise RuntimeError("Previous CDS/sample asset changed: "+path)
    if shared.digest(source)!=source_hash:raise RuntimeError("Source GLB changed during finishing")
    report={"id":"questrom-full","createdUTC":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"blender":bpy.app.version_string,
        "input":str(source),"inputSHA256":source_hash,"inputManifest":source_manifest,"output":str(destination),"sha256":shared.digest(destination),"bytes":destination.stat().st_size,
        "before":before,"after":after,"triangleDelta":after["triangles"]-before["triangles"],"primitives":primitives,"outwardExpansionMetres":expansion,
        "materials":[{"name":m.name,"source":m["bu_source_material"],"family":m["bu_texture_family"],"baseTintLinear":list(m["bu_base_tint"]),"bakedTileFamily":m.get("bu_baked_tile_family",m["bu_texture_family"])} for m in materials],
        "embeddedImages":len(document.get("images",[])),"tangentRepairs":repairs,"mobileOfflineSource":mobile,
        "protectedSurfaceGeometrySHA256":protected,"allUpperSourceFacesRetainedAboveMetres":7.5,"sourceFacesRetainedOutsideExplicitHandlesBevelsAndTwoBaseWraps":True,
        "baseWrapCorrection":base_wrap,
        "removedOldHandles":handle_report,"detail":detail,"detailTriangles":pipeline.geometry_stats(new_objects)["triangles"],"boundedBevels":bevel_report,"bevelAddedTriangles":bevel_triangles,
        "previousAssetsUnchangedSHA256":unchanged,"reusedTexturesSHA256":{str(p.relative_to(HERE)):shared.digest(p) for entries in textures.values() for p in entries.values()},
        "limitations":["Source model massing, approximate window/door geometry, source DEM and collision remain unchanged; not a new measured/as-built reconstruction.","Reference photo supports thin frame profiles, door/transom construction and pull hardware. Exact section sizes and the new 2.9m door head are authored estimates.","Only the two dark entrance bases widen 6 mm on each side to resolve source coplanar side faces; this thin wrap is authored, not surveyed. Heights/depths and all other roofs are unchanged.","Stone reuses the baked continuous concrete/mineral microtexture, preserving modeled large-panel joints without adding fictional small masonry bonds.","Opaque exterior glass uses the reviewed .2 linear tint/.16 roughness approach and requires runtime neighborhood reflection; no interior or transmission.","Canvas entrance inscription is excluded from this asset and must remain in the runtime extras group."]}
    for folder in (WORK,destination.parent):(folder/"manifest.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print("QUESTROM_FULL "+json.dumps({k:report[k] for k in ("bytes","before","after","triangleDelta","primitives","embeddedImages","detailTriangles","bevelAddedTriangles")}),flush=True)


if __name__=="__main__":main()
