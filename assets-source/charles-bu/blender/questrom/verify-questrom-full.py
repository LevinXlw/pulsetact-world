"""Validate actual Questrom GLB buffers and texture-free mobile parity."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[3]
spec=importlib.util.spec_from_file_location("glb_reader",HERE.parent/"full/verify-cds-full.py")
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)


def finish_triangles(doc,binary,finish):
    nodes=[n for n in doc["nodes"] if n.get("extras",{}).get("originalMaterial",{}).get("finish")==finish and not n.get("extras",{}).get("ground")]
    if len(nodes)!=1:raise AssertionError("Expected one unchanged architecture batch for "+finish)
    node=nodes[0]
    if any(k in node for k in ("matrix","translation","rotation","scale")):raise AssertionError("Expected source-local Questrom geometry")
    triangles=[]
    for primitive in doc["meshes"][node["mesh"]]["primitives"]:
        points=reader.accessor(doc,binary,primitive["attributes"]["POSITION"])
        ids=[i[0] for i in reader.accessor(doc,binary,primitive["indices"])] if "indices" in primitive else list(range(len(points)))
        triangles.extend(tuple(points[j] for j in ids[i:i+3]) for i in range(0,len(ids),3))
    return triangles


def ray_distance(triangles,origin,direction):
    def sub(a,b):return tuple(x-y for x,y in zip(a,b))
    def dot(a,b):return sum(x*y for x,y in zip(a,b))
    def cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
    closest=math.inf
    for a,b,c in triangles:
        e1,e2=sub(b,a),sub(c,a);h=cross(direction,e2);det=dot(e1,h)
        if abs(det)<1e-10:continue
        s=sub(origin,a);u=dot(s,h)/det
        if u<-.00001 or u>1.00001:continue
        q=cross(s,e1);v=dot(direction,q)/det
        if v<-.00001 or u+v>1.00001:continue
        distance=dot(e2,q)/det
        if distance>=0:closest=min(closest,distance)
    return closest


def main():
    asset=REPO/"public/assets/bu-questrom/questrom-full.glb"
    mobile=HERE/"questrom-mobile-source.glb"
    manifest=json.loads((HERE/"manifest.json").read_text(encoding="utf-8"))
    checks=[];report={"passed":False,"checks":checks}
    def check(condition,name):
        checks.append({"name":name,"passed":bool(condition)})
        if not condition:raise AssertionError(name)
    try:
        doc,binary=reader.read_glb(asset);phone,phone_bin=reader.read_glb(mobile)
        check(hashlib.sha256(asset.read_bytes()).hexdigest()==manifest["sha256"],"PBR asset matches manifest")
        check(hashlib.sha256(mobile.read_bytes()).hexdigest()==manifest["mobileOfflineSource"]["sha256"],"Mobile source matches manifest")
        check(asset.stat().st_size<10*1024*1024,"Complete Questrom under 10 MiB")
        check(not any(k in phone for k in ("textures","images","samplers")),"No mobile image loader inputs")
        check(doc["nodes"]==phone["nodes"] and doc["meshes"]==phone["meshes"],"Exact mobile node/mesh parity")
        check(len(doc["accessors"])==len(phone["accessors"]),"All mobile geometry accessors retained")
        for i in range(len(doc["accessors"])):check(reader.accessor(doc,binary,i)==reader.accessor(phone,phone_bin,i),f"Accessor {i} identical after removing textures")
        triangles=primitives=0;highest=-math.inf
        for mesh in doc["meshes"]:
            for primitive in mesh["primitives"]:
                label=mesh.get("name","mesh");a=primitive["attributes"];primitives+=1
                check(all(k in a for k in ("POSITION","NORMAL","TEXCOORD_0","TANGENT")),label+": complete PBR attributes")
                p,n,u,t=[reader.accessor(doc,binary,a[k]) for k in ("POSITION","NORMAL","TEXCOORD_0","TANGENT")]
                ids=reader.accessor(doc,binary,primitive["indices"])
                check(len(ids)%3==0 and all(0<=i[0]<len(p) for i in ids),label+": valid triangles")
                check(all(len(v)==len(p) for v in (n,u,t)),label+": aligned attributes")
                check(all(math.isfinite(v) for attr in (p,n,u,t) for row in attr for v in row),label+": finite geometry/UV")
                check(all(abs(sum(v*v for v in row)-1)<.002 for row in n),label+": unit normals")
                check(all(abs(sum(v*v for v in row[:3])-1)<.002 and abs(abs(row[3])-1)<.001 for row in t),label+": unit tangent frames")
                check(all(abs(sum(nn[i]*tt[i] for i in range(3)))<.003 for nn,tt in zip(n,t)),label+": orthogonal tangent frames")
                triangles+=len(ids)//3;highest=max(highest,max(point[1] for point in p))
        check(triangles==manifest["after"]["triangles"],"Measured full-building triangles match export")
        check(primitives==16 and primitives<=20,"Sixteen bounded draw calls")
        check(abs(highest-50.51)<.001,"Complete original roofline retained")
        check(manifest["triangleDelta"]<10000,"Incremental mobile geometry below 10k triangles")
        check(manifest["outwardExpansionMetres"]<=.001,"Source footprint and site envelope retained")
        wrap=manifest["baseWrapCorrection"]
        check(len(wrap["components"])==2 and wrap["trianglesChanged"]==24 and wrap["trianglesAdded"]==0,"Only two existing 12-triangle base wraps are resized")
        check(wrap["perSideMetres"]==.006 and wrap["untouchedRoofTriangles"]==48,"6 mm base wrap, all 48 unrelated roof triangles retained")
        source,source_bin=reader.read_glb(HERE/"input/questrom-full.glb")
        original_roof=finish_triangles(source,source_bin,"roof");actual_roof=finish_triangles(doc,binary,"roof")
        check(len(original_roof)==len(actual_roof)==72,"Actual roof triangle count unchanged")
        expected_roof=[];changed=[0,0]
        for tri in original_roof:
            match=next((i for i,x in enumerate((-.65,14.65)) if all(abs(p[0]-x)<.701 and -.0001<=p[1]<=.9001 and 20.0099<=p[2]<=22.0501 for p in tri)),None)
            if match is None:expected_roof.append(tri)
            else:
                cx=(-.65,14.65)[match];changed[match]+=1
                expected_roof.append(tuple((p[0]+(-.006 if p[0]<cx else .006),p[1],p[2]) for p in tri))
        check(changed==[12,12],"Source buffer matches exactly the two planned entrance base components")
        unmatched=[tuple(sorted(t)) for t in actual_roof]
        for triangle in expected_roof:
            wanted=tuple(sorted(triangle))
            index=next((i for i,t in enumerate(unmatched) if all(abs(x-y)<.00005 for a,b in zip(wanted,t) for x,y in zip(a,b))),None)
            if index is None:break
            unmatched.pop(index)
        check(not unmatched,"Actual roof buffers equal source except the two planned X-only 6 mm wraps")
        actual_stone=finish_triangles(doc,binary,"stone")
        for center in (-.65,14.65):
            for side in (-1,1):
                origin=(center+side*2,.45,21.03);direction=(-side,0,0)
                base_distance=ray_distance(actual_roof,origin,direction);pier_distance=ray_distance(actual_stone,origin,direction)
                check(math.isfinite(base_distance) and math.isfinite(pier_distance) and abs((pier_distance-base_distance)-.006)<.00005,f"Actual GLB base {center} side {side}: dark wrap covers stone side by 6 mm")
        check(len(manifest["removedOldHandles"])==5 and sum(h["triangles"] for h in manifest["removedOldHandles"])==60,"Five exact old box handles replaced without duplicates")
        check(manifest["detail"]["frontWindowsRefined"]==17 and manifest["detail"]["doorBaysRefined"]==5,"Visible first-floor windows and original five door bays refined")
        check(len(manifest["detail"]["apertureRayChecks"])==44 and all(p["newDetailClear"] for p in manifest["detail"]["apertureRayChecks"]),"44 actual construction rays retain visible glazing")
        check(all(abs(d["newClearWidthBetweenNarrowStilesMetres"]-d["originalBayWidthMetres"])<1e-8 for d in manifest["detail"]["doors"]),"New outer stiles retain the original pane widths")
        ground_nodes=[n for n in doc["nodes"] if n.get("extras",{}).get("ground")]
        check(len(ground_nodes)==4,"Four original ground batches retain ground flags")
        source_nodes=[n for n in doc["nodes"] if n.get("extras",{}).get("originalMaterial")]
        check(len(source_nodes)==16 and all(len(n["extras"]["originalMaterial"]["color"])==3 for n in source_nodes),"Original-material colors available to the mobile baker")
        check(not any("inscription" in n.get("name","").lower() for n in doc["nodes"]),"Canvas inscription remains outside the GLB")
        for image in doc.get("images",[]):
            check(image.get("mimeType")=="image/png" and "bufferView" in image,"Embedded PNG image")
            view=doc["bufferViews"][image["bufferView"]];blob=binary[view.get("byteOffset",0):view.get("byteOffset",0)+view["byteLength"]]
            check(blob[:8]==b"\x89PNG\r\n\x1a\n" and struct.unpack_from(">II",blob,16) in ((1024,1024),(512,512)),"Bounded reused image dimensions")
        for material,phone_material in zip(doc["materials"],phone["materials"]):
            pbr=material["pbrMetallicRoughness"];label=material["name"];extra=material.get("extras",{});family=extra.get("bu_texture_family")
            check(material.get("alphaMode","OPAQUE")=="OPAQUE",label+": opaque exterior")
            check(material.get("emissiveFactor",[0,0,0])==[0,0,0] and "emissiveTexture" not in material,label+": no emission")
            check(pbr["baseColorFactor"]==phone_material["pbrMetallicRoughness"]["baseColorFactor"],label+": same mobile tint")
            check("Texture" not in json.dumps(phone_material),label+": no mobile texture references")
            if family=="glass":
                check(abs(pbr.get("roughnessFactor",1)-.16)<.001 and pbr.get("metallicFactor",1)==0,label+": exterior dielectric glass")
                check("KHR_materials_transmission" not in material.get("extensions",{}) and abs(extra["bu_glass_tint_scale"]-.2)<1e-8,label+": no invented interior, reviewed tint")
            elif family!="plain":check("baseColorTexture" in pbr and "metallicRoughnessTexture" in pbr and "normalTexture" in material,label+": base/normal/roughness channels")
        for path,expected in manifest["previousAssetsUnchangedSHA256"].items():check(hashlib.sha256(Path(path).read_bytes()).hexdigest()==expected,"Previous CDS asset/code unchanged: "+Path(path).name)
        report.update({"passed":True,"triangles":triangles,"primitives":primitives,"bytes":asset.stat().st_size,"mobileBytes":mobile.stat().st_size,"images":len(doc.get("images",[]))})
    finally:(HERE/"verification.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k!="checks"}|{"checks":len(checks)}))


if __name__=="__main__":main()
