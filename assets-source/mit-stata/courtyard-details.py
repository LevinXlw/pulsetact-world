"""Rear Pisa volume and architectural roof edges, authored against CSAIL photos.

Position/scale come from the 2018 survey. The leaning circular sections are
photographic reconstruction, not claimed architect CAD. All units are metres.
"""
import math
from mathutils import Vector

PISA_CENTER=Vector((121.55,284.16,0))
PISA_TOP_CENTER=Vector((124.80,282.68,0))
PISA_PATCHES={81,268,295,296,297,298,299,300,301,319,372,381,382,383}
MATERIALS={
 'gold':((.82,.57,.055,1),.39,.42,None),
 'goldSeam':((.48,.30,.022,1),.47,.25,None),
 'room':((.085,.079,.063,1),.92,0,None),
 'blind':((.38,.35,.29,1),.90,0,None),
 'gasket':((.025,.029,.028,1),.85,0,None),
 'mirror':((.83,.86,.88,1),.12,.98,None),
}

def replaced_faces(vertices,faces,patches):
    out={f for p in patches if p['id'] in PISA_PATCHES for f in p['faces']}
    # The chimney has sub-8m2 source faces omitted from patches.json. Select
    # those from the already identified, closed survey component only.
    for f,ids in enumerate(faces):
        ps=[Vector(vertices[i]) for i in ids]
        if all(25.12<=p.z<=29.79 and (Vector((p.x,p.y,0))-PISA_TOP_CENTER).length<2.61 for p in ps):out.add(f)
    return out

def _ring(center,radius,z,count):
    return [Vector((center.x+radius*math.cos(i*math.tau/count),center.y+radius*math.sin(i*math.tau/count),z)) for i in range(count)]

def _surface(g,sections,mobile,material='gold',cap=True):
    count=32 if mobile else 96
    rings=[_ring(Vector((x,y,0)),r,z,count) for z,x,y,r in sections]
    for low,high in zip(rings,rings[1:]):
        for i in range(count):
            j=(i+1)%count
            g.polygon(material,[low[i],low[j],high[j],high[i]],[(i/count*12,low[i].z/2),(j/count*12,low[j].z/2),(j/count*12,high[j].z/2),(i/count*12,high[i].z/2)])
    if cap:g.polygon('roof',rings[-1])
    return rings

def add_pisa(g,mobile):
    # The lower cone tapers and moves off axis; the upper ventilation neck
    # leans independently. Retain source base and the surveyed maximum height.
    sections=[(15.83,121.55,284.16,6.0),(18.4,121.2,284.0,5.75),(21.6,120.65,283.8,5.25),(25.13,120.0,283.6,4.65)]
    _surface(g,sections,mobile)
    _surface(g,[(25.13,122.8,282.6,2.5),(27.6,123.45,282.6,2.25),(29.78,124.15,282.6,2.04)],mobile,cap=False)
    # Dark recessed opening with a substantial rolled metal rim, not a solid
    # low-poly polygon lid. The collar remains a closed exterior asset.
    outer=_ring(Vector((124.15,282.6,0)),2.04,29.78,32 if mobile else 96)
    inner=_ring(Vector((124.15,282.6,0)),1.90,29.78,len(outer))
    for i in range(len(outer)):
        j=(i+1)%len(outer)
        g.polygon('gold',[outer[i],outer[j],inner[j],inner[i]])
        g.polygon('reveal',[inner[i],inner[j],inner[j]-Vector((0,0,.6)),inner[i]-Vector((0,0,.6))])
    g.polygon('roof',[p-Vector((0,0,.6)) for p in inner])
    return {'pisa':'Survey-anchored leaning cones with open-rim exterior neck','sourceBase':[121.55,284.16,15.83],'sourceHeight':29.78,'photoEstimatedSections':sections}

def add_roof_copings(g,vertices,faces,patches,mappers,family_for):
    """Thin flashing only where surveyed masonry actually meets a roof."""
    edges={};owners={}
    for p in patches:
        family=family_for(p)
        for fi in p['faces']:
            ids=faces[fi]
            for a,b in zip(ids,ids[1:]+ids[:1]):
                key=tuple(sorted((tuple(round(c,4) for c in vertices[a]),tuple(round(c,4) for c in vertices[b]))))
                edges.setdefault(key,set()).add(p['id']);owners[p['id']]=p
    count=0
    for key,ids in edges.items():
        brick=[owners[i] for i in ids if family_for(owners[i])=='brick' and abs(owners[i]['normal'][2])<.4]
        roofs=[owners[i] for i in ids if owners[i]['normal'][2]>.9]
        if not brick or not roofs:continue
        a,b=map(Vector,key)
        if min(a.z,b.z)<11 or abs(a.z-b.z)>.4 or (a-b).length<.4:continue
        p=brick[0];mapper=mappers.get(p['id'])
        if mapper:a,b=mapper(a),mapper(b)
        n=Vector(p['normal']);along=(b-a).normalized();up=Vector((0,0,1))
        g.box('zinc',(a+b)*.5+up*.045+n*.02,along,n,up,(a-b).length,.32,.09)
        count+=1
    return count
