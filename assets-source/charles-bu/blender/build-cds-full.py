"""Finish the complete existing CDS building, preserving its source footprint.

  blender --background --python-exit-code 1 --python build-cds-full.py

Imports the whole tower (never stretches the ground-floor sample), reuses the
reviewed baked PBR tiles and the two accepted pass-2 entry-detail meshes. Four
identified source pull handles are replaced, not overlaid. Limited millimetre
bevels affect only closed near-ground metal/trim components; upper-storey faces,
all glazing and all terrain geometry remain source geometry. No downloads,
texture rebaking, runtime edits, or writes to previous review assets.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import importlib
import json
import math
from pathlib import Path
import struct
import sys
import time

import bpy
import bmesh
from mathutils import Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
pipeline = importlib.import_module("build-samples")
DETAIL_TAG = "cds-construction-20261019-v1"
UPPER_PROTECTED_HEIGHT = 7.5
MAX_BEVEL_COMPONENTS = 96
MAX_BEVEL_ADDED_TRIANGLES = 6000


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def meshes():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def surface_counter(obj, excluded=frozenset(), min_height=None):
    """Exact original coordinates/topology, independent of vertex numbering."""
    records = []
    for face in obj.data.polygons:
        if face.index in excluded:
            continue
        points = [obj.matrix_world @ obj.data.vertices[i].co for i in face.vertices]
        if min_height is not None and min(p.z for p in points) < min_height:
            continue
        records.append(tuple(sorted(tuple(float(v) for v in p) for p in points)))
    return Counter(records)


def surface_digest(obj):
    data = sorted((points, count) for points, count in surface_counter(obj).items())
    return hashlib.sha256(repr(data).encode()).hexdigest()


def bounds(points):
    lo = [min(p[i] for p in points) for i in range(3)]
    hi = [max(p[i] for p in points) for i in range(3)]
    return {"min": lo, "max": hi, "dimensions": [hi[i] - lo[i] for i in range(3)]}


def logical_components(obj, excluded):
    """Find connected source faces without welding or changing source vertices.

    glTF hard normals split box vertices. A 0.1 mm lookup joins their position
    aliases for selection only; the selected component alone is bevelled later.
    """
    point_faces, pending = {}, set()
    face_keys = {}
    for face in obj.data.polygons:
        if face.index in excluded:
            continue
        keys = {tuple(round(v, 4) for v in obj.data.vertices[i].co) for i in face.vertices}
        face_keys[face.index] = keys
        pending.add(face.index)
        for key in keys:
            point_faces.setdefault(key, set()).add(face.index)
    parts = []
    while pending:
        stack, part = [min(pending)], set()
        pending.remove(stack[0])
        while stack:
            index = stack.pop()
            part.add(index)
            for key in face_keys[index]:
                for other in point_faces[key].intersection(pending):
                    pending.remove(other)
                    stack.append(other)
        parts.append(part)
    return parts


def handle_faces(objects, evidence):
    removed, records = {}, []
    for original in evidence:
        expected = original["bounds"]
        found = []
        for obj in objects:
            if not any("frame" in slot.material.name.lower() for slot in obj.material_slots if slot.material):
                continue
            ids = set()
            for face in obj.data.polygons:
                points = [obj.matrix_world @ obj.data.vertices[i].co for i in face.vertices]
                if all(expected["min"][axis] - .0003 <= point[axis] <= expected["max"][axis] + .0003
                       for point in points for axis in range(3)):
                    ids.add(face.index)
            if ids:
                points = [obj.matrix_world @ obj.data.vertices[i].co for j in ids for i in obj.data.polygons[j].vertices]
                measured = bounds(points)
                triangles = sum(len(obj.data.polygons[i].vertices) - 2 for i in ids)
                if triangles != 12 or any(abs(measured[side][axis] - expected[side][axis]) > .0003 for side in ("min", "max") for axis in range(3)):
                    raise RuntimeError("Old handle is not the expected complete 12-triangle box: " + obj.name)
                found.append((obj, ids, measured, triangles))
        if len(found) != 1:
            raise RuntimeError("Expected exactly one source handle per accepted replacement location")
        obj, ids, measured, triangles = found[0]
        if removed.setdefault(obj.name, set()).intersection(ids):
            raise RuntimeError("Duplicate old-handle match")
        removed[obj.name].update(ids)
        records.append({"object": obj.name, "boundsBlender": measured, "triangles": triangles})
    if len(records) != 4:
        raise RuntimeError("Exactly four old source handles must be replaced")
    return removed, records


def bevel_component(obj, indices):
    faces = [obj.data.polygons[i] for i in sorted(indices)]
    vertices = sorted({v for face in faces for v in face.vertices})
    world = [obj.matrix_world @ obj.data.vertices[i].co for i in vertices]
    extent = bounds(world)
    shortest, longest = min(extent["dimensions"]), max(extent["dimensions"])
    if extent["max"][2] > UPPER_PROTECTED_HEIGHT or extent["min"][2] < -.01:
        return None
    if shortest < .02 or longest > 7.5 or longest < .10:
        return None
    bm = bmesh.new()
    lookup = {i: bm.verts.new(obj.data.vertices[i].co) for i in vertices}
    for face in faces:
        bm.faces.new([lookup[i] for i in face.vertices])
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.0001)
    bm.normal_update()
    if any(len(edge.link_faces) != 2 for edge in bm.edges) or any(f.calc_area() < 1e-9 for f in bm.faces):
        bm.free()
        return None
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    candidates = [e for e in bm.edges if e.calc_face_angle(0) > math.radians(30)]
    width = min(.003, shortest * .08)
    bmesh.ops.bevel(bm, geom=candidates, offset=width, segments=1, affect="EDGES", clamp_overlap=True)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], ngon_method="EAR_CLIP")
    bm.normal_update()
    output_vertices = [tuple(v.co) for v in bm.verts]
    mapping = {v: i for i, v in enumerate(bm.verts)}
    output_faces = [tuple(mapping[v] for v in face.verts) for face in bm.faces]
    output_normals = [tuple(face.normal) for face in bm.faces]
    triangles = sum(len(face) - 2 for face in output_faces)
    bm.free()
    return {"vertices": output_vertices, "faces": output_faces, "normals": output_normals,
            "material": faces[0].material_index, "sourceFaces": indices,
            "addedTriangles": triangles - sum(len(f.vertices) - 2 for f in faces),
            "widthMetres": width, "boundsBlender": extent}


def rebuild_selected(obj, removed, bevelled):
    """Replace only selected faces; copy all other coordinates and split normals."""
    omitted = set(removed)
    for part in bevelled:
        omitted.update(part["sourceFaces"])
    if not omitted:
        return
    expected = surface_counter(obj, omitted)
    source = obj.data
    vertices, faces, materials, normals, smooth = [], [], [], [], []
    # Per-loop source vertices retain hard-edge normals without global welding.
    for face in source.polygons:
        if face.index in omitted:
            continue
        ids = []
        for loop in face.loop_indices:
            ids.append(len(vertices))
            vertices.append(tuple(source.vertices[source.loops[loop].vertex_index].co))
            normals.append(tuple(source.corner_normals[loop].vector))
        faces.append(ids)
        materials.append(face.material_index)
        smooth.append(face.use_smooth)
    unchanged_count = len(faces)
    for part in bevelled:
        offset = len(vertices)
        vertices.extend(part["vertices"])
        for face, normal in zip(part["faces"], part["normals"]):
            faces.append(tuple(offset + i for i in face))
            materials.append(part["material"])
            normals.extend([normal] * len(face))
            smooth.append(False)
    new = bpy.data.meshes.new(source.name + " · bounded near-ground finishing")
    new.from_pydata(vertices, [], faces)
    for material in source.materials:
        new.materials.append(material)
    for face, material, shading in zip(new.polygons, materials, smooth):
        face.material_index, face.use_smooth = material, shading
    new.normals_split_custom_set(normals)
    obj.data = new
    new.update()
    excluded_added = set(range(unchanged_count, len(faces)))
    if surface_counter(obj, excluded_added) != expected:
        raise RuntimeError("An unselected source face changed: " + obj.name)


def append_reviewed_details(source_blend, material_cache):
    with bpy.data.libraries.load(str(source_blend), link=False) as (source, target):
        target.objects = [name for name in source.objects if name in ("CDS pass2 · metal construction", "CDS pass2 · column contact")]
    if len(target.objects) != 2:
        raise RuntimeError("Accepted pass2 must contain exactly the two named refinement batches")
    result = []
    for obj in target.objects:
        if obj.get("bu_refinement") != DETAIL_TAG:
            raise RuntimeError("Unexpected accepted refinement version")
        bpy.context.collection.objects.link(obj)
        for slot in obj.material_slots:
            key = slot.material["bu_source_material"].split(".")[0]
            if key not in material_cache:
                raise RuntimeError("Refinement material has no matching full-building source: " + key)
            slot.material = material_cache[key]
        obj["bu_full_building_detail"] = True
        result.append(obj)
    return result


def texture_free_source(source, destination):
    """Preserve geometry/tints while dropping PNGs and all texture references.

    The offline mobile baker must never instantiate a browser image loader.
    Repack live accessor bufferViews as well, so the unused embedded PNG bytes
    are not carried through its import. This does not edit the PBR asset.
    """
    data = source.read_bytes()
    json_size = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20:20 + json_size])
    binary = data[28 + json_size:]

    def remove_maps(value):
        if isinstance(value, dict):
            for key in list(value):
                if key.endswith("Texture") or key in ("normalTexture", "occlusionTexture"):
                    value.pop(key)
                else:
                    remove_maps(value[key])
        elif isinstance(value, list):
            for child in value:
                remove_maps(child)

    for material in document.get("materials", []):
        remove_maps(material)
    for key in ("images", "textures", "samplers"):
        document.pop(key, None)
    for key in ("extensionsUsed", "extensionsRequired"):
        if key in document:
            document[key] = [name for name in document[key] if name not in ("KHR_texture_transform", "KHR_texture_basisu", "EXT_texture_webp", "EXT_texture_avif")]
            if not document[key]:
                document.pop(key)
    live = set()
    for accessor in document["accessors"]:
        if "bufferView" in accessor:
            live.add(accessor["bufferView"])
        for key in ("indices", "values"):
            if key in accessor.get("sparse", {}):
                live.add(accessor["sparse"][key]["bufferView"])
    packed, views, mapping = bytearray(), [], {}
    for index in sorted(live):
        view = dict(document["bufferViews"][index])
        packed.extend(b"\0" * ((-len(packed)) % 4))
        original_offset = view.get("byteOffset", 0)
        view["byteOffset"], view["buffer"] = len(packed), 0
        packed.extend(binary[original_offset:original_offset + view["byteLength"]])
        mapping[index] = len(views)
        views.append(view)
    for accessor in document["accessors"]:
        if "bufferView" in accessor:
            accessor["bufferView"] = mapping[accessor["bufferView"]]
        for key in ("indices", "values"):
            if key in accessor.get("sparse", {}):
                item = accessor["sparse"][key]
                item["bufferView"] = mapping[item["bufferView"]]
    packed.extend(b"\0" * ((-len(packed)) % 4))
    document["bufferViews"], document["buffers"] = views, [{"byteLength": len(packed)}]
    document.setdefault("asset", {}).setdefault("extras", {})["purpose"] = "Texture-free offline mobile bake source; identical full CDS geometry and PBR base tints."
    encoded = json.dumps(document, separators=(",", ":"), ensure_ascii=True).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    output = struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(packed)) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + struct.pack("<II", len(packed), 0x004E4942) + packed
    destination.write_bytes(output)
    return {"path": str(destination), "sha256": digest(destination), "bytes": len(output), "images": 0, "textures": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=HERE / "full/input/cds-full.glb")
    parser.add_argument("--output", type=Path, default=REPO / "public/assets/bu-cds/cds-full.glb")
    parser.add_argument("--blend", type=Path, default=HERE / "full/cds-full.blend")
    parser.add_argument("--inspect-only", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if not args.input.is_file():
        raise FileNotFoundError("Full-source export is not ready: " + str(args.input))
    previous = [HERE / "cds-ground.blend", HERE / "pass2/cds-ground.blend",
                REPO / "public/assets/bu-quality/cds-ground.glb", REPO / "public/assets/bu-quality-pass2/cds-ground.glb"]
    previous_hashes = {str(path): digest(path) for path in previous}
    accepted = json.loads((HERE / "pass2/manifest.json").read_text(encoding="utf-8"))
    entry_report = next(item for item in accepted["samples"] if item["id"] == "cds-ground")
    pipeline.clear_objects()
    bpy.ops.import_scene.gltf(filepath=str(args.input.resolve()))
    originals = meshes()
    if not originals:
        raise RuntimeError("No full CDS meshes imported")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in originals:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = originals[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.view_layer.update()
    before = pipeline.geometry_stats(originals)
    if before["blenderBoundsMetres"]["max"][2] < 90:
        raise RuntimeError("Input is not the full CDS tower")
    print("BU_CDS_FULL_BASELINE " + json.dumps(before), flush=True)
    if args.inspect_only:
        return
    protected = {o.name: surface_digest(o) for o in originals if o.get("ground") or any("glass" in s.material.name.lower() or "paving" in s.material.name.lower() for s in o.material_slots if s.material)}
    upper = {o.name: surface_counter(o, min_height=UPPER_PROTECTED_HEIGHT) for o in originals}
    removed, removal_report = handle_faces(originals, entry_report["detail"]["removedHandleEvidence"])
    bevel_report, net_bevel_triangles = [], 0
    for obj in originals:
        parts = []
        eligible = obj.name not in protected and all(pipeline.family_for(s.material.name) in ("metal", "stone") for s in obj.material_slots if s.material)
        if eligible:
            for indices in logical_components(obj, removed.get(obj.name, set())):
                if len(bevel_report) >= MAX_BEVEL_COMPONENTS:
                    break
                part = bevel_component(obj, indices)
                if part and net_bevel_triangles + part["addedTriangles"] <= MAX_BEVEL_ADDED_TRIANGLES:
                    parts.append(part)
                    net_bevel_triangles += part["addedTriangles"]
                    bevel_report.append({"object": obj.name, **{k: part[k] for k in ("boundsBlender", "widthMetres", "addedTriangles")}})
        rebuild_selected(obj, removed.get(obj.name, set()), parts)
        if upper[obj.name] != surface_counter(obj, min_height=UPPER_PROTECTED_HEIGHT):
            raise RuntimeError("Upper-storey source geometry changed: " + obj.name)
        if obj.name in protected and surface_digest(obj) != protected[obj.name]:
            raise RuntimeError("Protected glazing or ground geometry changed: " + obj.name)
    textures = {family: {kind: HERE / "textures" / f"{family}-{kind}.png" for kind in ("basecolor", "normal", "orm")} for family in pipeline.TILES}
    if any(not path.is_file() for family in textures.values() for path in family.values()):
        raise RuntimeError("Reviewed PBR texture cache is incomplete; this script does not rebake it")
    materials_by_source = {}
    for obj in originals:
        for slot in obj.material_slots:
            original = slot.material
            key = original.name.split(".")[0]
            if key not in materials_by_source:
                materials_by_source[key] = pipeline.finish_material(original, textures, "cds-ground")
            slot.material = materials_by_source[key]
        pipeline.metre_uv(obj)
    new_objects = append_reviewed_details(HERE / "pass2/cds-ground.blend", materials_by_source)
    for obj in new_objects:
        pipeline.metre_uv(obj)
    objects = originals + new_objects
    bpy.context.view_layer.update()
    after = pipeline.geometry_stats(objects)
    expansion = max(0, *(before["blenderBoundsMetres"]["min"][i] - after["blenderBoundsMetres"]["min"][i] for i in range(3)), *(after["blenderBoundsMetres"]["max"][i] - before["blenderBoundsMetres"]["max"][i] for i in range(3)))
    if expansion > .001 or after["triangles"] - before["triangles"] > 11000:
        raise RuntimeError("Full-building envelope/triangle budget exceeded")
    materials = list(materials_by_source.values())
    for material in materials:
        tree = material.node_tree
        texture, bsdf = tree.nodes.get("BU basecolor"), tree.nodes.get("Exportable PBR")
        if texture:
            tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(args.output.resolve()), export_format="GLB", use_selection=True, export_apply=True, export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT", export_image_format="AUTO", export_extras=True, export_cameras=False, export_lights=False, export_animations=False, export_yup=True)
    document, repairs = pipeline.patch_base_tints(args.output, materials)
    primitives = sum(len(mesh["primitives"]) for mesh in document["meshes"])
    if primitives > 20 or args.output.stat().st_size > 10 * 1024 * 1024:
        raise RuntimeError("Full CDS exceeds 20 draw calls or 10 MiB")
    mobile = texture_free_source(args.output, args.blend.parent / "cds-mobile-source.glb")
    for material in materials:
        tree = material.node_tree
        multiply, bsdf = tree.nodes.get("Original building colour"), tree.nodes.get("Exportable PBR")
        if multiply:
            tree.links.new(multiply.outputs[0], bsdf.inputs["Base Color"])
        for node in tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                node.image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()), check_existing=False)
    for path, expected in previous_hashes.items():
        if digest(Path(path)) != expected:
            raise RuntimeError("A previous review asset was modified: " + path)
    input_manifest = args.input.parent / "manifest.json"
    report = {
        "id": "cds-full", "createdUTC": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "blender": bpy.app.version_string,
        "input": str(args.input), "inputSHA256": digest(args.input), "inputManifest": json.loads(input_manifest.read_text(encoding="utf-8")) if input_manifest.is_file() else None,
        "output": str(args.output), "sha256": digest(args.output), "bytes": args.output.stat().st_size,
        "before": before, "after": after, "triangleDelta": after["triangles"] - before["triangles"], "primitives": primitives,
        "materials": [{"name": m.name, "source": m["bu_source_material"], "family": m["bu_texture_family"], "baseTintLinear": list(m["bu_base_tint"])} for m in materials],
        "embeddedImages": len(document.get("images", [])), "tangentRepairs": repairs,
        "mobileOfflineSource": mobile,
        "outwardExpansionMetres": expansion, "protectedSurfaceGeometrySHA256": protected,
        "allUpperSourceFacesRetainedAboveMetres": UPPER_PROTECTED_HEIGHT,
        "sourceFacesRetainedOutsideExplicitHandlesAndBevelSelections": True,
        "removedOldHandles": removal_report, "reviewedEntry": {"blend": str(HERE / "pass2/cds-ground.blend"), "sha256": previous_hashes[str(HERE / "pass2/cds-ground.blend")], "tag": DETAIL_TAG, "objects": [o.name for o in new_objects], "triangles": pipeline.geometry_stats(new_objects)["triangles"], "evidence": "pass2/manifest.json samples[cds-ground].detail"},
        "boundedBevels": bevel_report, "bevelAddedTriangles": net_bevel_triangles,
        "previousAssetsUnchangedSHA256": previous_hashes,
        "reusedTexturesSHA256": {str(path.relative_to(HERE)): digest(path) for family in textures.values() for path in family.values()},
        "limitations": ["Existing authored building massing/entrance axes are preserved; this is not a new as-built survey.", "Fine entry hardware and bevel dimensions remain the reviewed construction approximations.", "Opaque dielectric glazing is an exterior PBR approximation with no invented interior or transmission.", "Global scene lighting/environment is configured by Three.js, not baked into this asset.", "Full-source geographic transform remains in inputManifest; mesh coordinates are metre-scale sample-local coordinates."]}
    for directory in (args.output.parent, args.blend.parent):
        (directory / "manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    # Keep the editable closed-door source and all finishing assertions above.
    # The final shipped exterior has two narrowly prepared runtime door holes;
    # its animated leaves are provided by Three.js, not frozen in the GLB.
    from prepare_cds_doors import prepare
    door_report = prepare(args.output, args.blend.parent / "cds-mobile-source.glb")
    print("BU_CDS_RUNTIME_DOORS " + json.dumps(door_report), flush=True)
    report = json.loads((args.output.parent / "manifest.json").read_text(encoding="utf-8"))
    print("BU_CDS_FULL " + json.dumps({k: report[k] for k in ("bytes", "before", "after", "triangleDelta", "primitives", "embeddedImages", "bevelAddedTriangles")}), flush=True)


if __name__ == "__main__":
    main()
