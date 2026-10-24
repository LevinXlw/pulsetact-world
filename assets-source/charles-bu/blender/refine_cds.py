"""Small, inspectable construction details for the existing CDS PBR sample.

Import from Blender after loading cds-ground.blend, then call:
    added_objects, report = refine(source_mesh_objects)
The source is Z-up metres, exterior toward -Y. Only the four identified old
rectangular pull-handle islands are removed. All other input geometry and its
UV/material data remain in place. New details share the existing frame/trim
materials in two mesh batches. The caller owns export, UV projection and saving
a NEW file.

Standalone inspection (does not save a .blend or GLB):
    blender --background cds-ground.blend --python-exit-code 1 --python refine_cds.py

Reference boundary: bu-cds-entry-layout.ts and cds-entry-refinement-20261018.json
retain authored door axes, not measured entrances. Existing photographed public
glazing informs these construction types; section sizes, hardware and joints
below are authored approximations, NOT an as-built detail survey.
"""
from __future__ import annotations

from collections import Counter
import json
import math

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


TAG = "cds-construction-20261019-v1"
TOLERANCE = .0003  # Source glTF clipping leaves sub-millimetre coordinate noise.


def _bounds(points):
    lo = [min(p[i] for p in points) for i in range(3)]
    hi = [max(p[i] for p in points) for i in range(3)]
    return {"min": lo, "max": hi, "dimensions": [hi[i] - lo[i] for i in range(3)],
            "center": [(lo[i] + hi[i]) / 2 for i in range(3)]}


def _islands(obj):
    mesh = obj.data
    adjacent = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        adjacent[a].append(b)
        adjacent[b].append(a)
    remaining, parts = set(range(len(mesh.vertices))), []
    while remaining:
        stack, members = [remaining.pop()], set()
        while stack:
            index = stack.pop()
            members.add(index)
            for other in adjacent[index]:
                if other in remaining:
                    remaining.remove(other)
                    stack.append(other)
        record = _bounds([obj.matrix_world @ mesh.vertices[i].co for i in members])
        record["vertices"] = members
        parts.append(record)
    return sorted(parts, key=lambda p: p["center"])


def _size(part, dimensions):
    return all(abs(part["dimensions"][i] - value) <= TOLERANCE
               for i, value in enumerate(dimensions) if value is not None)


def _stats(objects):
    triangles = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    return {"meshObjects": len(objects), "vertices": sum(len(o.data.vertices) for o in objects),
            "triangles": triangles}


def _surface_signature(obj, excluded=frozenset()):
    # Order-independent position/face/UV evidence survives BMesh reindexing.
    mesh, records = obj.data, []
    uv = mesh.uv_layers.active
    for face in mesh.polygons:
        if any(i in excluded for i in face.vertices):
            continue
        corners = []
        for loop_index in face.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
            corners.append(tuple(round(v, 6) for v in vertex.co) +
                           tuple(round(v, 6) for v in uv.data[loop_index].uv) if uv else
                           tuple(round(v, 6) for v in vertex.co))
        records.append((face.material_index, tuple(sorted(corners))))
    return Counter(records)


class _Parts:
    def __init__(self):
        self.vertices, self.faces, self.smooth, self.records = [], [], [], []

    def _append(self, bm, kind, bevel):
        bm.normal_update()
        points = [v.co.copy() for v in bm.verts]
        offset, lookup = len(self.vertices), {v: i for i, v in enumerate(bm.verts)}
        self.vertices.extend(tuple(v) for v in points)
        for face in bm.faces:
            self.faces.append(tuple(offset + lookup[v] for v in face.verts))
            self.smooth.append(face.smooth)
        self.records.append({"kind": kind, "bevelMetres": bevel, **_bounds(points)})
        bm.free()

    def box(self, kind, center, dimensions, bevel=.002):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        for v in bm.verts:
            v.co = Vector([center[i] + v.co[i] * dimensions[i] for i in range(3)])
        bevel = min(bevel, min(dimensions) * .22)
        if bevel:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1,
                            affect="EDGES", clamp_overlap=True)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        self._append(bm, kind, bevel)

    def cylinder(self, kind, start, end, radius, bevel=.001):
        a, b = Vector(start), Vector(end)
        axis = (b - a).normalized()
        transform = Matrix.Translation((a + b) / 2) @ Vector((0, 0, 1)).rotation_difference(axis).to_matrix().to_4x4()
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=12,
                              radius1=radius, radius2=radius, depth=(b - a).length,
                              matrix=transform)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.normal_update()
        rims = [e for e in bm.edges if e.calc_face_angle(0) > math.radians(55)]
        if rims and bevel:
            bmesh.ops.bevel(bm, geom=rims, offset=bevel, segments=1,
                            affect="EDGES", clamp_overlap=True)
        bm.normal_update()
        for face in bm.faces:
            face.smooth = abs(face.normal.dot(axis)) < .99
        self._append(bm, kind, bevel)

    def ring(self, kind, center, width, depth, thickness, height):
        # Four bars form a hollow collar; nothing fills or replaces the column.
        x, y, z = center
        for side in (-1, 1):
            self.box(kind, (x, y + side * (depth + thickness) / 2, z),
                     (width + 2 * thickness, thickness, height), .001)
            self.box(kind, (x + side * (width + thickness) / 2, y, z),
                     (thickness, depth, height), .001)

    def foot(self, kind, corners, bottom, top):
        # Short column extension, restricted to its own 34 cm footprint. Each
        # lower corner follows the existing paving instead of flattening it.
        bm = bmesh.new()
        verts = [bm.verts.new((x, y, bottom[i])) for i, (x, y) in enumerate(corners)]
        verts += [bm.verts.new((x, y, top)) for x, y in corners]
        for indices in [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
                        (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
            bm.faces.new([verts[i] for i in indices])
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=.003, segments=1,
                        affect="EDGES", clamp_overlap=True)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        self._append(bm, kind, .003)

    def mesh(self, material, collection, name):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.materials.append(material)
        mesh.update()
        for face, smooth in zip(mesh.polygons, self.smooth):
            face.use_smooth = smooth
        uv = mesh.uv_layers.new(name="UVMap")
        # The caller reprojects with shared metre_uv before export. These UVs
        # already use the source family's metre scale; no new images are made.
        tile = (2.8, 1.4) if material.get("bu_texture_family") == "stone" else (1, 1)
        for face in mesh.polygons:
            axis = max(range(3), key=lambda i: abs(face.normal[i]))
            for loop_index in face.loop_indices:
                p = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                raw = ((p.x, p.y) if axis == 2 else (p.x, p.z) if axis == 1 else (p.y, p.z))
                uv.data[loop_index].uv = (raw[0] / tile[0], raw[1] / tile[1])
        obj = bpy.data.objects.new(name, mesh)
        obj["bu_refinement"] = TAG
        obj["bu_detail_source"] = "Authored construction detail on existing CDS ground-floor sample; not measured"
        collection.objects.link(obj)
        return obj


def refine(objects):
    """Return ([added_mesh_objects], JSON-serializable_report), no file writes.

    Fail closed if the expected two doors/four old handles are absent. This is
    deliberately a refinement of this documented sample, not a generic scene
    remodeler. Re-running on the same scene is rejected to prevent duplication.
    """
    objects = [obj for obj in objects if obj.type == "MESH"]
    if any(obj.get("bu_refinement") == TAG for obj in bpy.context.scene.objects):
        raise ValueError("CDS refinement already exists; reload the unmodified source before calling refine().")
    def one(suffix):
        found = [o for o in objects if o.name.endswith("· " + suffix)]
        if len(found) != 1:
            raise ValueError(f"Expected one source CDS {suffix} mesh, found {len(found)}")
        return found[0]
    frame, glass, columns, ground = one("frame"), one("glassShade"), one("trim"), one("paving")
    if len(frame.data.materials) != 1:
        raise ValueError("Source frame material must be a single existing PBR material")
    material = frame.data.materials[0]
    if material.get("bu_texture_family") != "metal":
        raise ValueError("Expected baked PBR metal family on source frame")
    # New pieces are created in the input's actual world frame, not a guessed
    # GIS offset. Applying a nontrivial scale to the sample is not supported.
    for obj in objects:
        if any(abs(v - 1) > 1e-6 for v in obj.matrix_world.to_scale()):
            raise ValueError("Apply sample scales before CDS refinement")
    before = _stats(objects)
    original_material_count = len(bpy.data.materials)
    parts = _islands(frame)
    panes = [p for p in _islands(glass) if _size(p, (1.37, 0, 2.65))]
    handles = [p for p in parts if _size(p, (.035, .080, .56))]
    pillars = [p for p in _islands(columns) if _size(p, (.34, .34, 5.52))]
    if len(panes) != 4 or len(handles) != 4 or len(pillars) != 2:
        raise ValueError(f"Unexpected source: panes={len(panes)}, handles={len(handles)}, columns={len(pillars)}")
    panes.sort(key=lambda p: p["center"][0])
    groups = [panes[:2], panes[2:]]
    # The frame jambs define the existing clear opening. No new member is
    # allowed to project into that width at the exterior jamb plane.
    jambs = [p for p in parts if _size(p, (.075, .4, 2.75))]
    if len(jambs) != 4:
        raise ValueError("Expected four unchanged source jambs")
    door_records = []
    for pair in groups:
        cx = sum(p["center"][0] for p in pair) / 2
        if abs(pair[1]["center"][0] - pair[0]["center"][0] - 1.45) > TOLERANCE:
            raise ValueError("Door leaves no longer match the source pair")
        matching = [p for p in handles if abs(p["center"][0] - cx) < .2]
        if len(matching) != 2 or any(abs(p["center"][2] - 1.15) > TOLERANCE for p in matching):
            raise ValueError("Old handle islands are not at the documented door hardware positions")
        pair_jambs = sorted([p for p in jambs if abs(p["center"][0] - cx) < 1.5], key=lambda p: p["center"][0])
        if len(pair_jambs) != 2:
            raise ValueError("Door jamb pairing is ambiguous")
        door_records.append({"centerX": cx, "glazingY": sum(p["center"][1] for p in pair) / 2,
                             "originalOuterFrameWidthMetres": pair_jambs[1]["center"][0] - pair_jambs[0]["center"][0],
                             "originalClearWidthBetweenJambsMetres": pair_jambs[1]["min"][0] - pair_jambs[0]["max"][0],
                             "openingUnchanged": True})

    output = _Parts()
    # Give the eight formerly flat mullion sheets a shallow three-dimensional
    # pressure cap while retaining their exact original front width and height.
    mullions = [p for p in parts if p["dimensions"][1] < TOLERANCE and
                abs(p["dimensions"][0] - .075) < TOLERANCE and p["dimensions"][2] >= 2.7]
    for p in mullions:
        x, y, z = p["center"]
        output.box("curtain-wall pressure cap", (x, y - .018, z), (.060, .036, p["dimensions"][2]), .002)
    # Outer reveal caps sit on existing frame faces, not inside their opening.
    for p in jambs:
        x, _, z = p["center"]
        output.box("outer jamb cap", (x, p["min"][1] - .010, z), (.065, .020, p["dimensions"][2] - .01), .002)
    heads = [p for p in parts if _size(p, (2.9, .4, .09))]
    for p in heads:
        output.box("outer head cap", (p["center"][0], p["min"][1] - .01, p["center"][2]), (2.82, .020, .070), .002)

    for p in panes:
        lo, hi, center = p["min"], p["max"], p["center"]
        y = lo[1] - .025
        for side in (-1, 1):
            x = lo[0] + .018 if side < 0 else hi[0] - .018
            output.box("door leaf stile", (x, y, center[2]), (.036, .050, hi[2] - lo[2]), .0025)
        # Wider lower rail protects the glass; it is on the door leaf itself,
        # not a raised obstacle in front of the sill or the source ramp.
        output.box("door leaf bottom rail", (center[0], y, lo[2] + .070), (hi[0] - lo[0] - .072, .05, .140), .0025)
        output.box("door leaf top rail", (center[0], y, hi[2] - .050), (hi[0] - lo[0] - .072, .05, .100), .0025)

    # Precisely replace the four square pulls with round grips and two narrow
    # standoffs/roses each. The grip stays within its previous bounds; the
    # slightly wider roses and deeper standoffs explicitly attach it to glass.
    for h in handles:
        x, y, z = h["center"]
        pane = min(panes, key=lambda p: abs(p["center"][0] - x))
        radius = .016
        grip_y = h["min"][1] + radius
        output.cylinder("round pull grip", (x, grip_y, h["min"][2] + radius),
                        (x, grip_y, h["max"][2] - radius), radius, .001)
        for dz in (-.215, .215):
            mount_z = z + dz
            glass_y = pane["min"][1]
            output.cylinder("handle glass fixing rose", (x, glass_y - .008, mount_z),
                            (x, glass_y + .001, mount_z), .024, .0007)
            output.cylinder("handle standoff", (x, grip_y, mount_z),
                            (x, glass_y - .007, mount_z), .009, .0007)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    ground_bvh = BVHTree.FromObject(ground, depsgraph)
    ground_samples, feet = [], _Parts()
    for p in pillars:
        x, y, _ = p["center"]
        corners = [(x - .17, y - .17), (x + .17, y - .17),
                   (x + .17, y + .17), (x - .17, y + .17)]
        floor_heights = []
        for px, py in corners:
            hit = ground_bvh.ray_cast(ground.matrix_world.inverted() @ Vector((px, py, 2)), Vector((0, 0, -1)), 5)
            if hit[0] is None:
                raise ValueError("Existing paving is missing underneath a CDS column")
            floor_heights.append((ground.matrix_world @ hit[0]).z)
        floor = max(floor_heights)
        ground_samples.append({"x": x, "y": y, "groundCornerZ": floor_heights,
                               "sourceColumnBottomZ": p["min"][2]})
        if floor < p["min"][2] - .005:
            feet.foot("column contact extension", corners,
                      [v - .008 for v in floor_heights], p["min"][2] + .008)
        # A metal junction only 10 mm proud of the original white column.
        output.ring("column foot junction", (x, y, max(floor + .026, p["min"][2] + .026)), .34, .34, .010, .040)
        output.ring("column head junction", (x, y, p["max"][2] - .025), .34, .34, .010, .040)
    for pair in groups:
        x = sum(p["center"][0] for p in pair) / 2
        # A 3 mm cap follows the existing level sill/landing; no new step and
        # no changes to terrain, threshold apron or gameplay collision.
        sill = next(p for p in parts if _size(p, (2.9, .4, .05)) and abs(p["center"][0] - x) < .01)
        output.box("flush threshold cap", (x, sill["center"][1], sill["max"][2] + .0015),
                   (2.82, .34, .003), .0005)

    # Preserve every other original face and its UV coordinates exactly.
    removed_vertices = set().union(*(h["vertices"] for h in handles))
    expected_frame = _surface_signature(frame, removed_vertices)
    untouched = {o.name: _surface_signature(o) for o in objects if o != frame}
    frame.data.calc_loop_triangles()
    removed_triangles = sum(any(v in removed_vertices for v in tri.vertices) for tri in frame.data.loop_triangles)
    bm = bmesh.new()
    bm.from_mesh(frame.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in removed_vertices], context="VERTS")
    bm.to_mesh(frame.data)
    bm.free()
    frame.data.update()
    if _surface_signature(frame) != expected_frame or any(_surface_signature(o) != untouched[o.name] for o in objects if o != frame):
        raise RuntimeError("Unexpected modification outside the four original handle islands")
    added = [output.mesh(material, frame.users_collection[0], "CDS pass2 · metal construction")]
    if feet.records:
        added.append(feet.mesh(columns.data.materials[0], columns.users_collection[0], "CDS pass2 · column contact"))
    structure = dict.fromkeys(["boundaryEdges", "nonManifoldEdges", "degenerateFaces", "nonFiniteVertices"], 0)
    for obj in added:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        structure["boundaryEdges"] += sum(e.is_boundary for e in bm.edges)
        structure["nonManifoldEdges"] += sum(not e.is_manifold for e in bm.edges)
        structure["degenerateFaces"] += sum(f.calc_area() < 1e-10 for f in bm.faces)
        structure["nonFiniteVertices"] += sum(not all(math.isfinite(v) for v in vertex.co) for vertex in bm.verts)
        bm.free()
    added_stats = _stats(added)
    if any(structure.values()) or added_stats["triangles"] >= 10000:
        raise RuntimeError("New CDS geometry failed structural/budget checks: " + json.dumps(structure))
    if len(bpy.data.materials) != original_material_count:
        raise RuntimeError("CDS detail unexpectedly allocated a new material")
    bpy.context.view_layer.update()
    # Verify visible geometry, not only construction counts. The source doors
    # must stay visible through both leaf axes; a ray under each old floating
    # column must now hit the local extension. Threshold top rises only 3 mm.
    trees = [(o, BVHTree.FromObject(o, depsgraph)) for o in objects + added]
    def ray_hit(origin, direction, max_distance=10):
        hits = []
        for obj, tree in trees:
            local_origin = obj.matrix_world.inverted() @ Vector(origin)
            local_direction = obj.matrix_world.inverted().to_3x3() @ Vector(direction)
            hit = tree.ray_cast(local_origin, local_direction, max_distance)
            if hit[0] is not None:
                point = obj.matrix_world @ hit[0]
                hits.append(((point - Vector(origin)).length, obj, point))
        return min(hits, key=lambda h: h[0]) if hits else None
    for door in door_records:
        for dx in (-.6, .6):
            hit = ray_hit((door["centerX"] + dx, -1, 1.7), (0, 1, 0))
            if hit is None or hit[1] != glass:
                raise RuntimeError("New CDS detail obscures the original door leaf approach")
        hit = ray_hit((door["centerX"] + .6, door["glazingY"] - .14, .30), (0, 0, -1), 1)
        if hit is None or abs(hit[2].z - .153) > .0001:
            raise RuntimeError("CDS threshold cap does not meet the existing level sill")
    for sample in ground_samples:
        z = (max(sample["groundCornerZ"]) + sample["sourceColumnBottomZ"]) / 2
        hit = ray_hit((sample["x"], sample["y"] - .5, z), (0, 1, 0), 1)
        if hit is None or hit[1].name != "CDS pass2 · column contact":
            raise RuntimeError("CDS column remains unsupported above the source paving")
    after = _stats(objects + added)
    report = {
        "revision": TAG,
        "coordinates": "Blender Z-up metres; exterior toward -Y; follows actual source island positions",
        "before": before, "after": after,
        "addedTriangles": added_stats["triangles"], "removedTriangles": removed_triangles,
        "triangleDelta": after["triangles"] - before["triangles"],
        "addedMeshBatches": len(added), "newMaterials": 0, "newTextureImages": 0,
        "reusedMaterials": [o.data.materials[0].name for o in added],
        "detailCounts": dict(Counter(p["kind"] for p in output.records + feet.records)),
        "removedHandleEvidence": [{"object": frame.name, "vertices": len(h["vertices"]),
                                   "bounds": {k: h[k] for k in ("min", "max", "dimensions")}} for h in handles],
        "doorGroups": door_records,
        "columnGroundSamples": ground_samples,
        "checks": {**structure, "allUnreplacedSourceFacesAndUVsUnchanged": True,
                   "doorGlazingAndRampUnchanged": True, "doorLeafApproachRaysClear": True,
                   "columnContactRaysClosed": True, "thresholdTopZ": .153, "noNewInterior": True},
        "parts": output.records + feet.records,
        "sourceNotes": [
            "src/features/world/bu-cds-entry-layout.ts: existing approximate doors and retained canopy columns",
            "assets-source/charles-bu/cds-entry-refinement-20261018.json: evidence and authorship boundary",
            "No new site survey. Hardware diameters, stile/rail profiles, pressure caps and column joints are authored construction approximations.",
            "Four old 0.035 x 0.080 x 0.560 m handle islands removed only after exact size/placement matching; no overlapping duplicate grips.",
            "Two batches reuse the baked frame/trim materials. Short column extensions close the measured source-model 13-16 cm paving gap within each 34 cm footprint, without flattening terrain.",
            "Existing source dimensions, door glazing, terrain ramp and closed exterior remain unchanged. No change to gameplay collision in this standalone sample.",
        ],
    }
    return added, report


if __name__ == "__main__":
    created, stats = refine([obj for obj in bpy.context.scene.objects if obj.type == "MESH"])
    print("CDS_REFINEMENT " + json.dumps(stats, ensure_ascii=False, sort_keys=True), flush=True)
