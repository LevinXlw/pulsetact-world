"""Snapshot only the measured triangles beneath the Baker north entry.
The source is the existing campus terrain, with no modifications or flattening.
"""
from pathlib import Path
import json,struct,math
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
source=ROOT/'public/assets/mit-residences/campus-without-residences.glb'
raw=source.read_bytes();js=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+js]);blob=raw[28+js:]
def acc(i):
    a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC3':3}[a['type']];fmt={5126:'f',5125:'I',5123:'H'}[a['componentType']];size=struct.calcsize('<'+fmt*n);offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',size)
    return [struct.unpack_from('<'+fmt*n,blob,offset+j*stride) for j in range(a['count'])]
origin=(-293.6132807121133,251.20050008562413);u=(-.8855115793057221,-.46461730802401857);n=(.46461730802401857,-.8855115793057221)
def local(p):
    dx=p[0]-origin[0];dz=p[2]-origin[1];return [dx*u[0]+dz*u[1],dx*n[0]+dz*n[1],p[1]]
triangles=[]
for mesh in doc['meshes']:
    for p in mesh['primitives']:
        if doc['materials'][p['material']].get('name')!='2025 orthophotography':continue
        vertices=acc(p['attributes']['POSITION']);indices=[x[0] for x in acc(p['indices'])] if 'indices' in p else list(range(len(vertices)))
        for k in range(0,len(indices),3):
            ps=[local(vertices[indices[k+j]]) for j in range(3)]
            if max(p[0] for p in ps)<-20 or min(p[0] for p in ps)>17 or max(p[1] for p in ps)<-4 or min(p[1] for p in ps)>24:continue
            triangles.append(ps)
result={'source':str(source.relative_to(ROOT)).replace('\\','/'),'material':'2025 orthophotography','axes':'local s,d,worldY; s=(-.885512,-.464617) and d=(.464617,-.885512) in Three XZ','originXZ':origin,'triangles':triangles}
(HERE/'entry-terrain.json').write_text(json.dumps(result,separators=(',',':')))
print('Saved',len(triangles),'measured terrain triangles')
