"""Build two reviewable BU PBR samples with Blender, without external assets.

Run with Blender 4.5 LTS (Cycles CPU works without a discrete GPU):
  blender --background --python-exit-code 1 --python build-samples.py -- --ids bay-state-192 cds-ground

Source geometry and material colours come from the project's current models.
Dimensions, texture weathering and small bevels are authored, not a new survey.
This script deliberately never modifies any TypeScript or the campus-wide GLB.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import time

import bpy
import bmesh
from mathutils import Vector

# Blender --python does not consistently add the script's directory to sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from glb_finish import repair_zero_tangents


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
TILES = {
    "brick": {"metres": (2.30, 1.20), "roughness": (.73, .91), "bump": .008},
    "stone": {"metres": (2.80, 1.40), "roughness": (.62, .84), "bump": .004},
    "concrete": {"metres": (2.00, 2.00), "roughness": (.72, .91), "bump": .0015},
    "wood": {"metres": (.50, 2.00), "roughness": (.48, .70), "bump": .0009},
    "metal": {"metres": (1.00, 1.00), "roughness": (.24, .39), "bump": .00025},
}


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=HERE / "input")
    parser.add_argument("--output-dir", type=Path, default=REPO / "public/assets/bu-quality")
    parser.add_argument("--blend-dir", type=Path, default=HERE)
    parser.add_argument("--texture-dir", type=Path, default=HERE / "textures")
    parser.add_argument("--ids", nargs="+", default=["bay-state-192", "cds-ground"])
    parser.add_argument("--color-size", type=int, default=1024)
    parser.add_argument("--detail-size", type=int, default=512)
    parser.add_argument("--samples", type=int, default=16)
    parser.add_argument("--max-mb", type=float, default=10.0)
    parser.add_argument("--reuse-textures", action="store_true", help="Reuse this script's existing baked PNGs.")
    parser.add_argument("--skip-blend", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if args.color_size < 128 or args.detail_size < 128 or args.samples < 1:
        parser.error("Texture sizes must be at least 128 and samples must be positive.")
    return args


def log(message):
    print("BU_SAMPLES " + message, flush=True)


def node(tree, kind, name):
    item = tree.nodes.new(kind)
    item.label = item.name = name
    return item


def math_node(tree, operation, a, b=None, name=None):
    n = node(tree, "ShaderNodeMath", name or operation)
    n.operation = operation
    for i, value in enumerate([a] if b is None else [a, b]):
        if isinstance(value, (int, float)):
            n.inputs[i].default_value = value
        else:
            tree.links.new(value, n.inputs[i])
    return n.outputs[0]


def ramp(tree, value, low, high, name):
    n = node(tree, "ShaderNodeMapRange", name)
    n.inputs["From Min"].default_value = 0
    n.inputs["From Max"].default_value = 1
    n.inputs["To Min"].default_value = low
    n.inputs["To Max"].default_value = high
    tree.links.new(value, n.inputs["Value"])
    return n.outputs["Result"]


def periodic_noise(tree, uv, scale, name):
    """Map UV to a 4D torus: colour/roughness/normal repeat at tile boundaries."""
    split = node(tree, "ShaderNodeSeparateXYZ", name + " UV")
    tree.links.new(uv, split.inputs[0])
    angle_x = math_node(tree, "MULTIPLY", split.outputs["X"], math.tau)
    angle_y = math_node(tree, "MULTIPLY", split.outputs["Y"], math.tau)
    vector = node(tree, "ShaderNodeCombineXYZ", name + " torus")
    tree.links.new(math_node(tree, "COSINE", angle_x), vector.inputs["X"])
    tree.links.new(math_node(tree, "SINE", angle_x), vector.inputs["Y"])
    tree.links.new(math_node(tree, "COSINE", angle_y), vector.inputs["Z"])
    noise = node(tree, "ShaderNodeTexNoise", name)
    noise.noise_dimensions = "4D"
    tree.links.new(vector.outputs[0], noise.inputs["Vector"])
    tree.links.new(math_node(tree, "SINE", angle_y), noise.inputs["W"])
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 3
    noise.inputs["Roughness"].default_value = .64
    return noise.outputs["Fac"]


def procedural_material(family):
    spec = TILES[family]
    material = bpy.data.materials.new("BU bake source " + family)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = node(tree, "ShaderNodeOutputMaterial", "Output")
    bsdf = node(tree, "ShaderNodeBsdfPrincipled", "Procedural PBR")
    uv = node(tree, "ShaderNodeTexCoord", "Repeat coordinates").outputs["UV"]
    noise = periodic_noise(tree, uv, 3.2, "Mineral variation")
    fine = periodic_noise(tree, uv, 23, "Fine grain")
    colour = ramp(tree, noise, .84, .99, "Subtle weathering")
    relief = math_node(tree, "MULTIPLY", fine, .12)
    if family in ("brick", "stone"):
        mapping = node(tree, "ShaderNodeVectorMath", "Metre-scale masonry")
        mapping.operation = "MULTIPLY"
        tree.links.new(uv, mapping.inputs[0])
        mapping.inputs[1].default_value = (*spec["metres"], 1)
        brick = node(tree, "ShaderNodeTexBrick", "Masonry bonds")
        tree.links.new(mapping.outputs[0], brick.inputs["Vector"])
        brick.offset = .5
        brick.offset_frequency = 2
        brick.inputs["Scale"].default_value = 1
        brick.inputs["Brick Width"].default_value = .23 if family == "brick" else .70
        brick.inputs["Row Height"].default_value = .075 if family == "brick" else .35
        brick.inputs["Mortar Size"].default_value = .004 if family == "brick" else .002
        brick.inputs["Mortar Smooth"].default_value = .003 if family == "brick" else .0015
        brick.inputs["Color1"].default_value = (.91, .91, .91, 1)
        brick.inputs["Color2"].default_value = (1, 1, 1, 1)
        brick.inputs["Mortar"].default_value = (.67, .67, .67, 1)
        mixed = node(tree, "ShaderNodeMixRGB", "Masonry patina")
        mixed.blend_type = "MULTIPLY"
        mixed.inputs[0].default_value = 1
        tree.links.new(brick.outputs["Color"], mixed.inputs[1])
        tree.links.new(colour, mixed.inputs[2])
        colour = mixed.outputs[0]
        # Brick Fac is 1 in mortar; invert so mortar is recessed.
        relief = math_node(tree, "ADD", math_node(tree, "SUBTRACT", 1, brick.outputs["Fac"]), relief)
    elif family == "wood":
        split = node(tree, "ShaderNodeSeparateXYZ", "Grain direction")
        tree.links.new(uv, split.inputs[0])
        wave = math_node(tree, "SINE", math_node(tree, "ADD", math_node(tree, "MULTIPLY", split.outputs["X"], math.tau * 16), math_node(tree, "MULTIPLY", noise, 2)))
        grain = ramp(tree, math_node(tree, "ADD", math_node(tree, "MULTIPLY", wave, .5), .5), .84, .99, "Timber grain")
        # Use subdued grain; the actual door panels remain source geometry.
        colour = grain
        relief = math_node(tree, "MULTIPLY", grain, .3)
    rough = ramp(tree, noise, *spec["roughness"], "Roughness variation")
    tree.links.new(colour, bsdf.inputs["Base Color"])
    tree.links.new(rough, bsdf.inputs["Roughness"])
    bump = node(tree, "ShaderNodeBump", "Physical surface relief")
    bump.inputs["Distance"].default_value = spec["bump"]
    bump.inputs["Strength"].default_value = 1
    tree.links.new(relief, bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    tree.links.new(bsdf.outputs[0], output.inputs["Surface"])
    orm = node(tree, "ShaderNodeCombineColor", "ORM channels")
    orm.mode = "RGB"
    orm.inputs[0].default_value = 1
    tree.links.new(rough, orm.inputs[1])
    orm.inputs[2].default_value = 0
    return material, colour, orm.outputs[0], bsdf, output


def clear_objects():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def texture_recipe_hash():
    """Material-only colour edits must not invalidate unchanged baked images."""
    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    names = {"node", "math_node", "ramp", "periodic_noise", "procedural_material"}
    parts = [item for item in tree.body if (
        isinstance(item, ast.FunctionDef) and item.name in names
    ) or (
        isinstance(item, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "TILES" for target in item.targets)
    )]
    return hashlib.sha256(ast.dump(ast.Module(body=parts, type_ignores=[]), include_attributes=False).encode()).hexdigest()


def bake_tiles(args):
    args.texture_dir.mkdir(parents=True, exist_ok=True)
    # Bump bakeRecipeVersion when changing bake-plane/colour-management settings.
    recipe = {"textureRecipeSHA256": texture_recipe_hash(), "bakeRecipeVersion": 1, "colorSize": args.color_size, "detailSize": args.detail_size, "samples": args.samples}
    recipe_path = args.texture_dir / "bake-recipe.json"
    previous = json.loads(recipe_path.read_text(encoding="utf-8")) if recipe_path.is_file() else None
    can_reuse = args.reuse_textures and previous == recipe
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.render.bake.use_clear = True
    scene.render.bake.margin = 2
    scene.render.bake.use_selected_to_active = False
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 80
    result = {}
    for family, spec in TILES.items():
        paths = {kind: args.texture_dir / f"{family}-{kind}.png" for kind in ("basecolor", "normal", "orm")}
        if can_reuse and all(path.is_file() for path in paths.values()):
            result[family] = paths
            log("Reusing baked tiles: " + family)
            continue
        clear_objects()
        width, height = spec["metres"]
        mesh = bpy.data.meshes.new("Physical bake plane")
        mesh.from_pydata([(0, 0, 0), (width, 0, 0), (width, height, 0), (0, height, 0)], [], [(0, 1, 2, 3)])
        mesh.uv_layers.new(name="UVMap")
        for i, uv in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
            mesh.uv_layers.active.data[i].uv = uv
        obj = bpy.data.objects.new("PBR bake plane", mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        material, colour, orm, bsdf, output = procedural_material(family)
        obj.data.materials.append(material)
        tree = material.node_tree
        emission = node(tree, "ShaderNodeEmission", "Data bake emission")
        target = node(tree, "ShaderNodeTexImage", "Active bake target")
        for kind, path in paths.items():
            size = args.color_size if kind == "basecolor" else args.detail_size
            image = bpy.data.images.new(f"BU {family} {kind}", width=size, height=size, alpha=False)
            image.colorspace_settings.name = "sRGB" if kind == "basecolor" else "Non-Color"
            target.image = image
            tree.nodes.active = target
            if kind == "normal":
                tree.links.new(bsdf.outputs[0], output.inputs["Surface"])
                scene.render.bake.normal_space = "TANGENT"
                bpy.ops.object.bake(type="NORMAL")
            else:
                tree.links.new(colour if kind == "basecolor" else orm, emission.inputs["Color"])
                tree.links.new(emission.outputs[0], output.inputs["Surface"])
                bpy.ops.object.bake(type="EMIT")
            image.filepath_raw = str(path.resolve())
            image.file_format = "PNG"
            image.save()
            log(f"Baked {family}/{kind}: {size}², {path.stat().st_size:,} bytes")
        result[family] = paths
    clear_objects()
    recipe_path.write_text(json.dumps(recipe, indent=2), encoding="utf-8")
    return result


def family_for(name):
    value = name.lower()
    if "glass" in value:
        return "glass"
    if any(word in value for word in ("wood", "timber")):
        return "wood"
    if any(word in value for word in ("frame", "metal", "iron", "steel", "bronze", "brass")):
        return "metal"
    if "brick" in value and "paving" not in value:
        return "brick"
    if any(word in value for word in ("stone", "trim", "paving")):
        return "stone"
    if any(word in value for word in ("concrete", "roof")):
        return "concrete"
    return "plain"


def source_colour(material):
    if material.use_nodes:
        bsdf = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            return [float(v) for v in bsdf.inputs["Base Color"].default_value[:3]]
    return list(material.diffuse_color[:3])


def finish_material(source, textures, sample_id):
    family = family_for(source.name)
    colour = source_colour(source)
    source_tint = list(colour)
    glass_tint_scale = .2 if sample_id == "cds-ground" and family == "glass" else 1
    colour = [value * glass_tint_scale for value in colour]
    material = bpy.data.materials.new(source.name + " · Blender PBR")
    material.use_nodes = True
    material.diffuse_color = (*colour, 1)
    material["bu_source_material"] = source.name
    material["bu_texture_family"] = family
    material["bu_base_tint"] = colour
    if glass_tint_scale != 1:
        material["bu_original_base_tint"] = source_tint
        material["bu_glass_tint_scale"] = glass_tint_scale
    tree = material.node_tree
    tree.nodes.clear()
    output = node(tree, "ShaderNodeOutputMaterial", "Output")
    bsdf = node(tree, "ShaderNodeBsdfPrincipled", "Exportable PBR")
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = .16 if family == "glass" else .84
    bsdf.inputs["Metallic"].default_value = (.7 if any(word in source.name.lower() for word in ("bronze", "brass")) else .12) if family == "metal" else 0
    bsdf.inputs["Alpha"].default_value = 1
    bsdf.inputs["Transmission Weight"].default_value = 0
    bsdf.inputs["Emission Strength"].default_value = 0
    tree.links.new(bsdf.outputs[0], output.inputs[0])
    if family in textures:
        images = {}
        for kind, path in textures[family].items():
            image = bpy.data.images.load(str(path.resolve()), check_existing=True)
            image.colorspace_settings.name = "sRGB" if kind == "basecolor" else "Non-Color"
            texture = node(tree, "ShaderNodeTexImage", "BU " + kind)
            texture.image = image
            texture.extension = "REPEAT"
            images[kind] = texture
        multiply = node(tree, "ShaderNodeMixRGB", "Original building colour")
        multiply.blend_type = "MULTIPLY"
        multiply.inputs[0].default_value = 1
        tree.links.new(images["basecolor"].outputs["Color"], multiply.inputs[1])
        multiply.inputs[2].default_value = (*colour, 1)
        tree.links.new(multiply.outputs[0], bsdf.inputs["Base Color"])
        normal = node(tree, "ShaderNodeNormalMap", "Baked tangent normal")
        tree.links.new(images["normal"].outputs["Color"], normal.inputs["Color"])
        tree.links.new(normal.outputs[0], bsdf.inputs["Normal"])
        separate = node(tree, "ShaderNodeSeparateColor", "glTF roughness / metallic")
        separate.mode = "RGB"
        tree.links.new(images["orm"].outputs["Color"], separate.inputs[0])
        tree.links.new(separate.outputs[1], bsdf.inputs["Roughness"])
        # Metallic is a material constant. Mortar, stone and painted frames
        # must not become metallic just because they share an ORM container.
    return material


def clean_and_bevel(obj):
    before = len(obj.data.vertices)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    bm.verts.index_update()
    seen, duplicates = set(), []
    for face in bm.faces:
        key = tuple(sorted(v.index for v in face.verts))
        if key in seen:
            duplicates.append(face)
        else:
            seen.add(key)
    if duplicates:
        bmesh.ops.delete(bm, geom=duplicates, context="FACES_ONLY")
    tiny = [face for face in bm.faces if face.calc_area() < 1e-8]
    if tiny:
        bmesh.ops.delete(bm, geom=tiny, context="FACES_ONLY")
    remaining, islands = set(bm.verts), []
    while remaining:
        stack, part = [remaining.pop()], []
        while stack:
            vertex = stack.pop()
            part.append(vertex)
            for edge in vertex.link_edges:
                other = edge.other_vert(vertex)
                if other in remaining:
                    remaining.remove(other)
                    stack.append(other)
        islands.append(part)
    bevelled, bevel_edges, widths = 0, 0, []
    for part in islands:
        edges = {edge for v in part for edge in v.link_edges}
        faces = {face for v in part for face in v.link_faces}
        if not edges or any(len(edge.link_faces) != 2 for edge in edges):
            continue  # Never bevel an open wall, glazing sheet, or window cut.
        names = " ".join(obj.data.materials[f.material_index].name.lower() for f in faces if f.material_index < len(obj.data.materials))
        metal = any(word in names for word in ("frame", "iron", "metal", "steel", "bronze", "brass"))
        stone = any(word in names for word in ("trim", "stone"))
        if not metal and not stone:
            continue
        dimensions = [max(v.co[i] for v in part) - min(v.co[i] for v in part) for i in range(3)]
        shortest, longest = min(dimensions), max(dimensions)
        if shortest < .018 or longest > (30 if metal else 6) or longest < .06:
            continue
        bmesh.ops.recalc_face_normals(bm, faces=list(faces))
        bm.normal_update()
        candidates = [edge for edge in edges if edge.is_valid and edge.calc_face_angle(0) > math.radians(25)]
        if not candidates:
            continue
        width = min(.008 if metal else .015, shortest * .10)
        bmesh.ops.bevel(bm, geom=candidates, offset=width, segments=2, profile=.5, affect="EDGES", clamp_overlap=True)
        bevelled += 1
        bevel_edges += len(candidates)
        widths.append(width)
    loose = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return {"object": obj.name, "inputVertices": before, "outputVertices": len(obj.data.vertices), "duplicatesRemoved": len(duplicates), "subPixelFacesRemoved": len(tiny), "closedComponentsBevelled": bevelled, "bevelEdges": bevel_edges, "bevelWidthMetres": [min(widths), max(widths)] if widths else []}


def metre_uv(obj):
    """Deterministic metre-density box projection; no proprietary UV unwrap."""
    mesh = obj.data
    uv = mesh.uv_layers.get("UVMap") or mesh.uv_layers.new(name="UVMap")
    mesh.uv_layers.active = uv
    for face in mesh.polygons:
        material = mesh.materials[face.material_index] if face.material_index < len(mesh.materials) else None
        family = material.get("bu_texture_family", "plain") if material else "plain"
        tw, th = TILES.get(family, {"metres": (1, 1)})["metres"]
        normal = face.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        for loop_index in face.loop_indices:
            p = obj.matrix_world @ mesh.vertices[mesh.loops[loop_index].vertex_index].co
            if axis == 2:
                u, v = p.x, p.y
            elif axis == 1:
                u, v = p.x * (1 if normal.y < 0 else -1), p.z
            else:
                u, v = p.y * (1 if normal.x > 0 else -1), p.z
            uv.data[loop_index].uv = (u / tw, v / th)
    return len(uv.data)


def bounds(objects):
    points = [obj.matrix_world @ Vector(p) for obj in objects for p in obj.bound_box]
    return {"min": [min(p[i] for p in points) for i in range(3)], "max": [max(p[i] for p in points) for i in range(3)]}


def geometry_stats(objects):
    triangles = vertices = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        vertices += len(obj.data.vertices)
    return {"objects": len(objects), "vertices": vertices, "triangles": triangles, "blenderBoundsMetres": bounds(objects)}


def patch_base_tints(path, materials):
    """GLB core PBR represents the preview's image×tint without shader nodes."""
    data = path.read_bytes()
    size, kind = struct.unpack_from("<II", data, 12)
    if kind != 0x4E4F534A:
        raise RuntimeError("Expected GLB JSON chunk")
    document = json.loads(data[20:20 + size])
    by_name = {material.name: material for material in materials}
    for material in document.get("materials", []):
        source = by_name.get(material.get("name"))
        if source is not None:
            material.setdefault("pbrMetallicRoughness", {})["baseColorFactor"] = list(source["bu_base_tint"]) + [1]
            material["alphaMode"] = "OPAQUE"
            material.pop("emissiveTexture", None)
            material["emissiveFactor"] = [0, 0, 0]
    binary_size, binary_kind = struct.unpack_from("<II", data, 20 + size)
    if binary_kind != 0x004E4942:
        raise RuntimeError("Expected GLB BIN chunk")
    binary = bytearray(data[28 + size:])
    if len(binary) != binary_size:
        raise RuntimeError("Incomplete GLB BIN chunk")
    tangent_repair = repair_zero_tangents(document, binary)
    encoded = json.dumps(document, separators=(",", ":"), ensure_ascii=True).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    remainder = struct.pack("<II", len(binary), binary_kind) + binary
    result = struct.pack("<III", 0x46546C67, 2, 20 + len(encoded) + len(remainder)) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + remainder
    path.write_bytes(result)
    return document, tangent_repair


def build_sample(sample_id, args, textures):
    source = args.input_dir / (sample_id + ".glb")
    if not source.is_file():
        raise FileNotFoundError(source)
    clear_objects()
    bpy.ops.import_scene.gltf(filepath=str(source.resolve()))
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not objects:
        raise RuntimeError("No mesh in " + str(source))
    # Apply importer transforms before measuring bevel widths in metres.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.view_layer.update()
    initial = geometry_stats(objects)
    cleanup = [clean_and_bevel(obj) for obj in objects]
    cache = {}
    for obj in objects:
        for slot in obj.material_slots:
            original = slot.material
            if original is None:
                continue
            if original.name not in cache:
                cache[original.name] = finish_material(original, textures, sample_id)
            slot.material = cache[original.name]
        metre_uv(obj)
    bpy.context.view_layer.update()
    final = geometry_stats(objects)
    drift = max(abs(initial["blenderBoundsMetres"][bound][i] - final["blenderBoundsMetres"][bound][i]) for bound in ("min", "max") for i in range(3))
    expansion = max(0, *(initial["blenderBoundsMetres"]["min"][i] - final["blenderBoundsMetres"]["min"][i] for i in range(3)), *(final["blenderBoundsMetres"]["max"][i] - initial["blenderBoundsMetres"]["max"][i] for i in range(3)))
    # A bevel removes up to 15 mm from a trim corner; it must never expand the
    # source envelope or shift the structure. Record the actual inward change.
    if expansion > .0003 or drift > .016:
        raise RuntimeError(f"Envelope changed by {drift:.6f}m (outward {expansion:.6f}m) in {sample_id}")
    materials = list(cache.values())
    # Bake-node graphs are retained in .blend as the reviewable source. Export
    # only supported image/Principled connections; base tint is a core GLB factor.
    for material in materials:
        tree = material.node_tree
        image, bsdf = tree.nodes.get("BU basecolor"), tree.nodes.get("Exportable PBR")
        if image:
            tree.links.new(image.outputs["Color"], bsdf.inputs["Base Color"])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    destination = args.output_dir / (sample_id + ".glb")
    bpy.ops.export_scene.gltf(filepath=str(destination.resolve()), export_format="GLB", use_selection=True, export_apply=True, export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT", export_image_format="AUTO", export_extras=True, export_cameras=False, export_lights=False, export_animations=False, export_yup=True)
    document, tangent_repair = patch_base_tints(destination, materials)
    for material in materials:
        tree = material.node_tree
        multiply, bsdf = tree.nodes.get("Original building colour"), tree.nodes.get("Exportable PBR")
        if multiply:
            tree.links.new(multiply.outputs[0], bsdf.inputs["Base Color"])
        for n in tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                n.image.pack()
    if not args.skip_blend:
        args.blend_dir.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str((args.blend_dir / (sample_id + ".blend")).resolve()), check_existing=False)
    families = sorted(set(material["bu_texture_family"] for material in materials))
    result = {
        "id": sample_id, "input": str(source), "inputSHA256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "output": str(destination), "bytes": destination.stat().st_size, "before": initial, "after": final,
        "envelopeMaxDriftMetres": drift, "envelopeOutwardExpansionMetres": expansion, "cleanup": cleanup,
        "materials": [{"name": m.name, "source": m["bu_source_material"], "family": m["bu_texture_family"], "baseTintLinear": list(m["bu_base_tint"]), "glassTintScale": m.get("bu_glass_tint_scale", 1), "originalBaseTintLinear": list(m.get("bu_original_base_tint", m["bu_base_tint"]))} for m in materials],
        "textureFamilies": families, "embeddedImages": len(document.get("images", [])), "exportedMaterials": len(document.get("materials", [])),
        "exportTangentRepair": tangent_repair,
        "uv": "Metre-density box projection, repeat wrapping; original GIS massing and openings retained.",
        "glass": "Opaque dielectric, roughness .16, transmission 0, emission 0; no fictional visible interiors.",
        "glassTint": "CDS glass and glassShade linear source colour multiplied by .2; all 192 Bay State glass colours remain unchanged." if sample_id == "cds-ground" else "Original linear source glass colour retained.",
    }
    log(f"Exported {sample_id}: {final['triangles']:,} triangles, {result['bytes']:,} bytes")
    return result


def main():
    args = arguments()
    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    log("Blender " + bpy.app.version_string + "; preparing real Cycles texture bakes")
    textures = bake_tiles(args)
    samples = [build_sample(sample_id, args, textures) for sample_id in args.ids]
    total = sum(sample["bytes"] for sample in samples)
    manifest = {
        "version": 1, "blender": bpy.app.version_string, "createdUTC": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "elapsedSeconds": round(time.time() - started, 2), "engine": "Cycles CPU", "bakeSamples": args.samples,
        "samples": samples, "totalGLBBytes": total, "limitBytes": int(args.max_mb * 1024 * 1024), "withinBudget": total < args.max_mb * 1024 * 1024,
        "textures": {family: {"repeatMetres": spec["metres"], "maps": {kind: {"path": str(path), "bytes": path.stat().st_size, "size": args.color_size if kind == "basecolor" else args.detail_size} for kind, path in textures[family].items()}} for family, spec in TILES.items()},
        "limitations": ["Source massing is the current project model, not a new as-built survey.", "Masonry bonds, weathering, grain and sub-centimetre relief are authored PBR approximations.", "UV seams can occur where box-projection axes change on curved surfaces.", "No campus-wide runtime replacement or deployment is performed by this script."],
    }
    args.blend_dir.mkdir(parents=True, exist_ok=True)
    (args.blend_dir / "build-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    log(f"Complete: {total:,} bytes combined; budget {'PASS' if manifest['withinBudget'] else 'FAIL'}")
    if not manifest["withinBudget"]:
        raise RuntimeError("Combined sample GLBs exceed --max-mb")


if __name__ == "__main__":
    main()
