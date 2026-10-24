"""Refine the frozen material samples, preserving the previous review assets.

Run with Blender --background --python-exit-code 1 --python <this file>.
Geometry refinements are local authored construction details, not a new survey.
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
import bmesh

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
pipeline = importlib.import_module("build-samples")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mesh_digest(obj):
    """Record actual source topology/positions independently of new pieces."""
    data = hashlib.sha256()
    for row in obj.matrix_world:
        data.update(struct.pack("<4d", *row))
    for vertex in obj.data.vertices:
        data.update(struct.pack("<3d", *vertex.co))
    for face in obj.data.polygons:
        data.update(struct.pack("<II", len(face.vertices), face.material_index))
        for index in face.vertices:
            data.update(struct.pack("<I", index))
    return data.hexdigest()


def meshes():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def material_key(obj):
    return " ".join(slot.material.name.lower() for slot in obj.material_slots if slot.material)


def build(sample_id, output_dir, blend_dir):
    source = HERE / f"{sample_id}.blend"
    baseline = REPO / f"public/assets/bu-quality/{sample_id}.glb"
    source_hash, baseline_hash = digest(source), digest(baseline)
    bpy.ops.wm.open_mainfile(filepath=str(source))
    bpy.context.preferences.filepaths.save_version = 0
    originals = meshes()
    original_hashes = {obj.name: mesh_digest(obj) for obj in originals}
    # The aperture and grade surfaces are invariants, even when hardware is replaced.
    protected = {obj.name: mesh_digest(obj) for obj in originals if any(word in material_key(obj) for word in ("glass", "paving"))}
    before = pipeline.geometry_stats(originals)
    module = importlib.import_module("refine_bay_state" if sample_id == "bay-state-192" else "refine_cds")
    new_objects, detail = module.refine(originals)
    if not new_objects:
        raise RuntimeError(f"No refinement geometry produced for {sample_id}")
    for obj in new_objects:
        obj["bu_refinement_pass"] = 2
    bpy.ops.object.select_all(action="DESELECT")
    for obj in new_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = new_objects[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    triangulated_caps = 0
    for obj in new_objects:
        # glTF tangent export requires triangles/quads. Round hardware has ngon caps.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        caps = [face for face in bm.faces if len(face.verts) > 4]
        triangulated_caps += len(caps)
        if caps:
            bmesh.ops.triangulate(bm, faces=caps, ngon_method="EAR_CLIP")
            bm.normal_update()
            bm.to_mesh(obj.data)
            obj.data.update()
        bm.free()
        pipeline.metre_uv(obj)
    bpy.context.view_layer.update()
    objects = meshes()
    if len(objects) > len(originals) + 6:
        raise RuntimeError("Refinement must batch small construction pieces by material")
    by_name = {obj.name: obj for obj in objects}
    for name, expected in protected.items():
        if name not in by_name or mesh_digest(by_name[name]) != expected:
            raise RuntimeError(f"Original glass/aperture or grade geometry changed: {name}")
    final = pipeline.geometry_stats(objects)
    if final["triangles"] - before["triangles"] > 14000:
        raise RuntimeError("Refinement exceeds the sample's incremental triangle budget")
    expansion = max(0, *(before["blenderBoundsMetres"]["min"][i] - final["blenderBoundsMetres"]["min"][i] for i in range(3)), *(final["blenderBoundsMetres"]["max"][i] - before["blenderBoundsMetres"]["max"][i] for i in range(3)))
    if expansion > .16:
        raise RuntimeError(f"New trim exceeds 16 cm exterior envelope allowance: {expansion}")
    materials = list({slot.material.name: slot.material for obj in objects for slot in obj.material_slots if slot.material}.values())
    for material in materials:
        if "bu_base_tint" not in material:
            raise RuntimeError(f"Untracked material: {material.name}")
        tree = material.node_tree
        image, bsdf = tree.nodes.get("BU basecolor"), tree.nodes.get("Exportable PBR")
        if image:
            tree.links.new(image.outputs["Color"], bsdf.inputs["Base Color"])
    # Operators inside refinement modules may have changed the selection.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    destination = output_dir / f"{sample_id}.glb"
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format="GLB", use_selection=True, export_apply=True, export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT", export_image_format="AUTO", export_extras=True, export_cameras=False, export_lights=False, export_animations=False, export_yup=True)
    document, repairs = pipeline.patch_base_tints(destination, materials)
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            if not all(key in primitive["attributes"] for key in ("POSITION", "NORMAL", "TEXCOORD_0", "TANGENT")):
                raise RuntimeError(f"Incomplete PBR geometry export: {mesh['name']}")
    for material in materials:
        tree = material.node_tree
        multiply, bsdf = tree.nodes.get("Original building colour"), tree.nodes.get("Exportable PBR")
        if multiply:
            tree.links.new(multiply.outputs[0], bsdf.inputs["Base Color"])
        for node in tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                node.image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_dir / f"{sample_id}.blend"), check_existing=False)
    if digest(source) != source_hash or digest(baseline) != baseline_hash:
        raise RuntimeError("Previous review assets were unexpectedly modified")
    return {
        "id": sample_id, "sourceBlend": str(source), "sourceSHA256": source_hash,
        "baselineGLB": str(baseline), "baselineSHA256": baseline_hash,
        "output": str(destination), "sha256": digest(destination), "bytes": destination.stat().st_size,
        "before": before, "after": final, "outwardExpansionMetres": expansion,
        "protectedSurfacesUnchanged": list(protected),
        "changedOriginalMeshes": [name for name, expected in original_hashes.items() if name not in by_name or mesh_digest(by_name[name]) != expected],
        "detail": detail, "newMeshCount": len(new_objects),
        "newNgonCapsTriangulatedForTangentExport": triangulated_caps,
        "embeddedImages": len(document.get("images", [])), "exportedMaterials": len(document.get("materials", [])),
        "tangentRepairs": repairs,
    }


def main():
    # Always publish a complete pair so the manifest and combined budget match.
    output_dir = REPO / "public/assets/bu-quality-pass2"
    blend_dir = HERE / "pass2"
    output_dir.mkdir(parents=True, exist_ok=True)
    blend_dir.mkdir(parents=True, exist_ok=True)
    reports = [build(sample_id, output_dir, blend_dir) for sample_id in ("bay-state-192", "cds-ground")]
    total = sum(item["bytes"] for item in reports)
    if total > 10 * 1024 * 1024:
        raise RuntimeError("Sample assets exceed the combined 10 MiB review budget")
    report = {"pass": 2, "blender": bpy.app.version_string, "createdUTC": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "samples": reports, "totalBytes": total,
        "limitations": ["Fine construction dimensions are authored estimates derived from existing openings, not an as-built survey.", "Glazing remains the prior opaque PBR approximation; no interior or transmission is introduced.", "These are local review assets, not a campus-wide replacement."]}
    for folder in (output_dir, blend_dir):
        (folder / "manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("BU_REFINED " + json.dumps({"bytes": total, "samples": [{"id": r["id"], "triangles": r["after"]["triangles"], "newMeshes": r["newMeshCount"]} for r in reports]}), flush=True)


if __name__ == "__main__":
    main()
