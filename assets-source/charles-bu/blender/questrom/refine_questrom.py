"""Bounded entry/window construction on the existing complete Questrom source.

Coordinates are Blender Z-up metres. Front is -Y. The source's window recesses,
five door-bay positions, pane sizes, and all ground remain unchanged. Detail
section sizes and the door/transom split are authored, not survey measurements.
"""
from __future__ import annotations

from collections import Counter
import importlib
import math
from pathlib import Path
import sys

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
geometry = importlib.import_module("build-cds-full")
# Reuse only the tested mesh primitive generator; do not execute or modify the
# previous CDS refinement, files, materials, or model.
from refine_cds import _Parts

TAG = "questrom-construction-20261019-v1"


def source_parts(obj):
    result = []
    for indices in geometry.logical_components(obj, set()):
        points = [obj.matrix_world @ obj.data.vertices[i].co for j in indices for i in obj.data.polygons[j].vertices]
        b = geometry.bounds(points)
        b["faces"] = indices
        b["center"] = [(b["min"][i] + b["max"][i]) / 2 for i in range(3)]
        result.append(b)
    return result


def remove_old_handles(originals):
    frame = next(o for o in originals if o.name.endswith("· frame"))
    chosen = []
    for part in source_parts(frame):
        if all(abs(a-b) < .0003 for a,b in zip(part["dimensions"], (.055,.080,.55))):
            chosen.append(part)
    chosen.sort(key=lambda p:p["center"][0])
    expected = [2.48,5.13,7.78,10.43,13.08]
    if len(chosen) != 5 or any(abs(part["center"][0]-x)>.0003 or abs(part["center"][1]+20.18)>.0003 or abs(part["center"][2]-1.55)>.0003 for part,x in zip(chosen,expected)):
        raise RuntimeError("Expected five precise source box handles at the retained door bays")
    ids, evidence = set(), []
    for part in chosen:
        triangles = sum(len(frame.data.polygons[i].vertices)-2 for i in part["faces"])
        if triangles != 12:
            raise RuntimeError("A source handle is not one complete 12-triangle box")
        ids.update(part["faces"])
        evidence.append({k:part[k] for k in ("min","max","center","dimensions")} | {"triangles":triangles})
    return {frame.name:ids}, evidence


def wrap_entry_bases(originals):
    """Separate two existing dark base wraps from the coplanar stone pier sides.

    The source boxes have the same 1.40 m width as their stone piers. Moving
    only their two X faces out by 6 mm expresses a thin wrap, without moving
    the piers, door apertures, terrain, top roofs, or any component in Y/Z.
    This is an explicit render/construction correction, not a survey dimension.
    """
    roof = next(o for o in originals if o.name.endswith("· roof"))
    selected = [p for p in source_parts(roof) if all(abs(a-b)<.0003 for a,b in zip(p["dimensions"],(1.4,2.04,.9)))]
    selected.sort(key=lambda p:p["center"][0])
    expected = [(-.65,-21.03,.45),(14.65,-21.03,.45)]
    if len(selected)!=2 or any(any(abs(a-b)>.0003 for a,b in zip(p["center"],c)) for p,c in zip(selected,expected)):
        raise RuntimeError("Expected exactly the two complete source entrance-base boxes")
    faces = set().union(*(p["faces"] for p in selected))
    untouched = geometry.surface_counter(roof,excluded=faces)
    records = []
    inverse = roof.matrix_world.inverted()
    for part in selected:
        if sum(len(roof.data.polygons[i].vertices)-2 for i in part["faces"])!=12:
            raise RuntimeError("Entrance base is not one complete 12-triangle source box")
        vertex_ids = {i for j in part["faces"] for i in roof.data.polygons[j].vertices}
        if any(vertex_ids.intersection(face.vertices) for face in roof.data.polygons if face.index not in part["faces"]):
            raise RuntimeError("Entrance base unexpectedly shares vertices with another roof component")
        for i in vertex_ids:
            point = roof.matrix_world @ roof.data.vertices[i].co
            side = -1 if point.x<part["center"][0] else 1
            edge = part["min"][0] if side<0 else part["max"][0]
            if abs(point.x-edge)>.0003:raise RuntimeError("Base has a vertex outside its two matched X planes")
            point.x += side*.006
            roof.data.vertices[i].co = inverse @ point
        after = geometry.bounds([roof.matrix_world @ roof.data.vertices[i].co for i in vertex_ids])
        if any(abs(after[key][axis]-part[key][axis])>1e-7 for key in ("min","max") for axis in (1,2)):
            raise RuntimeError("Base wrapping changed source depth or height")
        records.append({"object":roof.name,"before":{k:part[k] for k in ("min","max","center","dimensions")},"after":after,"triangles":12})
    roof.data.update()
    if untouched!=geometry.surface_counter(roof,excluded=faces):raise RuntimeError("Base wrapping changed an unrelated roof face")
    return {"perSideMetres":.006,"axis":"Blender X / glTF X","components":records,"trianglesChanged":24,"trianglesAdded":0,"untouchedRoofTriangles":sum(untouched.values()),"depthAndHeightUnchanged":True,"reason":"Two original 1.40 m dark bases were coplanar with their 1.40 m stone piers; authored 6 mm side wrap resolves the overlap."}


def verify_entry_base_rays(originals):
    """Check actual finished base/pier geometry, away from bevelled corners."""
    trees = {}
    for finish in ("roof","stone"):
        obj = next(o for o in originals if o.name.endswith("· "+finish))
        trees[finish] = BVHTree.FromPolygons([obj.matrix_world @ v.co for v in obj.data.vertices],[list(f.vertices) for f in obj.data.polygons],all_triangles=False)
    records = []
    for center_x in (-.65,14.65):
        for side in (-1,1):
            origin = Vector((center_x+side*2,-21.03,.45)); direction=Vector((-side,0,0))
            base = trees["roof"].ray_cast(origin,direction,3)
            pier = trees["stone"].ray_cast(origin,direction,3)
            if base[0] is None or pier[0] is None or abs((pier[3]-base[3])-.006)>.00005:
                raise RuntimeError("Dark base does not cover the corresponding stone pier by 6 mm")
            records.append({"centerX":center_x,"side":side,"originBlender":list(origin),"baseHitBlender":list(base[0]),"pierHitBlender":list(pier[0]),"clearanceMetres":pier[3]-base[3]})
    return records


def build_details(originals, materials):
    glass = next(o for o in originals if o.name.endswith("· glassShade"))
    parts = source_parts(glass)
    window_candidates = sorted([p for p in parts if abs(p["dimensions"][0]-2.23)<.0003 and p["dimensions"][1]<.0003 and abs(p["dimensions"][2]-3.8)<.0003 and p["min"][1]<0 and p["max"][2]<5.5],key=lambda p:(p["center"][1],p["center"][0]))
    doors = sorted([p for p in parts if abs(p["dimensions"][0]-2.45)<.0003 and p["dimensions"][1]<.0003 and abs(p["dimensions"][2]-4.65)<.0003 and abs(p["center"][1]+20.025)<.0003],key=lambda p:p["center"][0])
    if len(window_candidates)!=19 or len(doors)!=5:
        raise RuntimeError(f"Unexpected source opening layout: front windows {len(window_candidates)}, door bays {len(doors)}")
    # Two existing office panes sit behind the separately modeled broad entry
    # bays. Do not spend new geometry on these concealed source surfaces.
    windows = [p for p in window_candidates if not any(d["center"][1]<p["center"][1] and p["min"][1]<-19 and d["max"][0]>p["min"][0] and d["min"][0]<p["max"][0] for d in doors)]
    if len(windows)!=17:raise RuntimeError("Entry overlap filtering changed unexpectedly")
    window_detail, entry_detail = _Parts(), _Parts()
    for p in windows:
        x,y,z = p["center"]
        w,h = p["dimensions"][0],p["dimensions"][2]
        # The old 65 mm flat ring lies 80 mm forward of the retained glass.
        # These 42 mm caps stay WITHIN that ring's aperture projection and well
        # behind the masonry face (320 mm forward of glass). No pale boxes.
        for sign in (-1,1):
            window_detail.box("recessed window pressure cap",(x+sign*(w/2-.0325),y-.083,z),(.042,.065,h-.065),.0015)
            window_detail.box("recessed window pressure cap",(x,y-.083,z+sign*(h/2-.0325)),(w-.065,.065,.042),.0015)
    door_records = []
    for p in doors:
        x,y,_ = p["center"]
        width = p["dimensions"][0]
        # Keep both outer bay limits and all existing glass intact. The narrow
        # door-head member distinguishes a 2.9 m leaf zone from fixed transom
        # glazing above; that height is authored from the observed construction.
        for sign in (-1,1):
            entry_detail.box("door perimeter stile",(x+sign*(width/2+.0275),y-.075,1.525),(.055,.075,2.65),.0015)
        entry_detail.box("door top and fixed transom rail",(x,y-.075,2.90),(width,.075,.095),.0015)
        entry_detail.box("door bottom rail cap",(x,y-.086,.25),(width,.055,.14),.0015)
        entry_detail.box("retained door waist rail cap",(x,y-.086,1.20),(width,.055,.045),.0015)
        for height in (.34,2.72):
            entry_detail.box("door hinge fixing plate",(x-width/2-.035,y-.085,height),(.065,.080,.085),.001)
        hx = x+.78
        grip_y = y-.095
        entry_detail.cylinder("round door pull grip",(hx,grip_y,1.285),(hx,grip_y,1.815),.016,.001)
        for height in (1.335,1.765):
            entry_detail.cylinder("pull fixing rosette",(hx,y-.004,height),(hx,y-.012,height),.024,0)
            entry_detail.cylinder("pull stand-off",(hx,y-.012,height),(hx,grip_y+.013,height),.009,0)
        door_records.append({"centerX":x,"originalBayWidthMetres":width,"glazingY":y,"doorTopMetres":2.90,"newClearWidthBetweenNarrowStilesMetres":width,"originalGlassUnchanged":True,"handleAxisX":hx})
    added = [window_detail.mesh(materials["frame"],bpy.context.collection,"Questrom refined · first-floor window metal"),entry_detail.mesh(materials["frame"],bpy.context.collection,"Questrom refined · entrance construction")]
    for obj in added:
        obj["bu_refinement"] = TAG
        obj["buLandmarkScope"] = "questrom"
        obj["ground"] = obj["buGround"] = False
        obj["bu_detail_source"] = "Existing photographed facade construction; profile sizes and 2.9 m door/transom split are authored estimates, not measured"
        obj["originalMaterial"] = {"name":"BU frame","finish":"frame","color":list(materials["frame"]["bu_base_tint"])}
        bm = bmesh.new();bm.from_mesh(obj.data)
        caps = [f for f in bm.faces if len(f.verts)>4]
        if caps:bmesh.ops.triangulate(bm,faces=caps,ngon_method="EAR_CLIP")
        bm.normal_update();bm.to_mesh(obj.data);bm.free();obj.data.update()
    bpy.context.view_layer.update()
    # Actual ray tests keep the visible glazing exposed, rather than merely
    # asserting the detail's authored dimensions. Avoid existing centre rails.
    depsgraph = bpy.context.evaluated_depsgraph_get()
    detail_trees = [(o,BVHTree.FromObject(o,depsgraph)) for o in added]
    glass_tree = BVHTree.FromObject(glass,depsgraph)
    probes = []
    for kind,opening,z in [("window",p,3.65) for p in windows]+[("door",p,1.90) for p in doors]:
        x,y,_ = opening["center"]
        for dx in (-.45,.45):
            origin,direction = Vector((x+dx,y-.6,z)),Vector((0,1,0))
            hit = glass_tree.ray_cast(origin,direction,1.0)
            if hit[0] is None or abs(hit[0].y-y)>.001:
                raise RuntimeError(f"Retained {kind} glazing ray failed: origin={list(origin)}, expectedY={y}, hit={hit[0]}")
            for obj,tree in detail_trees:
                detail_hit = tree.ray_cast(origin,direction,hit[3]-.0005)
                if detail_hit[0] is not None:
                    raise RuntimeError("New detail obscures clear aperture: "+obj.name)
            probes.append({"kind":kind,"origin":list(origin),"glassDistance":hit[3],"newDetailClear":True})
    topology=[]
    for obj in added:
        bm=bmesh.new();bm.from_mesh(obj.data)
        invalid=sum(not v.co.is_finite for v in bm.verts) if hasattr(Vector(),"is_finite") else sum(not all(math.isfinite(c) for c in v.co) for v in bm.verts)
        boundary=sum(e.is_boundary for e in bm.edges);nonmanifold=sum(not e.is_manifold for e in bm.edges)
        tiny=sum(f.calc_area()<1e-10 for f in bm.faces);bm.free()
        if invalid or boundary or nonmanifold or tiny:raise RuntimeError("Invalid new construction geometry")
        topology.append({"object":obj.name,"invalidVertices":invalid,"boundaryEdges":boundary,"nonmanifoldEdges":nonmanifold,"degenerateFaces":tiny})
    counts=Counter(r["kind"] for r in window_detail.records+entry_detail.records)
    return added,{"id":TAG,"frontWindowsRefined":len(windows),"doorBaysRefined":len(doors),"newMeshBatches":len(added),"semanticParts":dict(counts),"doors":door_records,"apertureRayChecks":probes,"newMeshTopology":topology,"parts":window_detail.records+entry_detail.records,"sourceNotes":[
        "BU entrance photograph: https://www.bu.edu/online/files/2025/05/BUQ-externals-5712-2048x1365.jpg",
        "BU full exterior photograph: https://www.bu.edu/files/2013/04/h_97-2661B-6.jpg",
        "Local inspected references: output/questrom-reference-front.jpg and output/questrom-reference-wide.jpg",
        "Existing shallow office-window apertures and five authored entry-bay axes remain unchanged. No new door opening, interior, stairs or geography.",
        "Pressure-cap sections, hardware sizes and the 2.9 m door/transom split are construction approximations, not an as-built survey.",
        "Only the five old box handles are replaced. Every other source face is protected outside the builder's explicit bounded bevel selections.",
    ]}
