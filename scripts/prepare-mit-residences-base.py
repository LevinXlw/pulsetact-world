"""Remove only Baker/Maseeh source triangles, retaining the existing Stata removal.
All original binary data and unrelated primitives are preserved byte for byte.
"""
import json, struct, hashlib, math, itertools, argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--mobile-only',action='store_true',help='Refresh only Boston phone base; preserve the desktop export.')
args=parser.parse_args()
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FT=1200/3937; ORIGIN=(766425.8129794697-731100,2956167.074144031-2902900)
source=[];counts={}
for name in ('baker','maseeh'):
    vs=[]; start=len(source)
    for line in (ROOT/f'assets-source/mit-residences/{name}/source.obj').read_text().splitlines():
        if line.startswith('v '):
            x,y,z=map(float,line.split()[1:4]);vs.append(((x-ORIGIN[0])*FT,z*FT,-(y-ORIGIN[1])*FT))
        elif line.startswith('f '):
            ids=[int(t.split('/')[0])-1 for t in line.split()[1:]];assert len(ids)==3
            source.append(tuple(vs[i] for i in ids))
    counts[name]=len(source)-start
def cell(t):return tuple(math.floor(sum(v[k] for v in t)/3/.01) for k in range(3))
buckets={}
for i,t in enumerate(source):buckets.setdefault(cell(t),[]).append(i)
perms=list(itertools.permutations(range(3)))
def match(t,tolerance,hits):
    c=cell(t)
    for d in itertools.product((-1,0,1),repeat=3):
        for j in buckets.get(tuple(c[k]+d[k] for k in range(3)),[]):
            if hits[j]:continue
            if any(max(abs(t[i][k]-source[j][p[i]][k]) for i in range(3) for k in range(3))<=tolerance for p in perms):return j
def read_glb(path):
    raw=path.read_bytes();assert raw[:4]==b'glTF'
    n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);bn=struct.unpack_from('<I',raw,20+n)[0]
    return raw,doc,raw[28+n:28+n+bn]
def values(doc,blob,aid):
    a=doc['accessors'][aid];v=doc['bufferViews'][a['bufferView']];fmt={5126:'f',5125:'I',5123:'H',5121:'B'}[a['componentType']];n={'VEC3':3,'SCALAR':1}[a['type']]
    fmt='<'+fmt*n;stride=v.get('byteStride',struct.calcsize(fmt));offset=v.get('byteOffset',0)+a.get('byteOffset',0)
    return [struct.unpack_from(fmt,blob,offset+i*stride) for i in range(a['count'])]
def save(path,doc,blob):
    doc['buffers'][0]['byteLength']=len(blob);j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);blob+=b'\0'*((-len(blob))%4)
    path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(blob))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(blob),b'BIN\0')+blob)
report={'sourceTriangles':counts,'assets':[]}
out=ROOT/'public/assets/mit-residences';out.mkdir(parents=True,exist_ok=True)
for prefix,tolerance in ([('boston',.00053)] if args.mobile_only else [('campus',.00004),('boston',.00053)]):
    src=ROOT/f'public/assets/mit-stata/{prefix}-without-stata.glb';raw,doc,blob=read_glb(src)
    candidates=[p for m in doc['meshes'] for p in m['primitives'] if doc['materials'][p['material']].get('name') in ('Cambridge buildings (untextured)','Cambridge_buildings_(untextured)')];assert len(candidates)==1
    p=candidates[0];positions=values(doc,blob,p['attributes']['POSITION']);indices=[v[0] for v in values(doc,blob,p['indices'])] if 'indices' in p else list(range(len(positions)))
    hits=[0]*len(source);keep=[]
    for i in range(0,len(indices),3):
        ids=indices[i:i+3];t=tuple(positions[j] for j in ids);j=match(t,tolerance,hits)
        if j is None:keep.extend(ids)
        else:hits[j]+=1
    assert all(n==1 for n in hits),[(i,n) for i,n in enumerate(hits) if n!=1][:20]
    offset=(len(blob)+3)//4*4;new=blob+b'\0'*(offset-len(blob))+struct.pack('<'+'I'*len(keep),*keep)
    vid=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(keep)*4,'target':34963})
    p['indices']=len(doc['accessors']);doc['accessors'].append({'bufferView':vid,'componentType':5125,'count':len(keep),'type':'SCALAR','min':[min(keep)],'max':[max(keep)]})
    dest=out/f'{prefix}-without-residences.glb';save(dest,doc,new)
    result,d2,b2=read_glb(dest);assert b2[:len(blob)]==blob;assert src.read_bytes()==raw
    if prefix=='boston':
        manifest={'version':1,'url':'/'+dest.relative_to(ROOT/'public').as_posix(),'sha256':hashlib.sha256(result).hexdigest(),'bytes':len(result),'inputUrl':'/'+src.relative_to(ROOT/'public').as_posix(),'inputSHA256':hashlib.sha256(raw).hexdigest(),'inputBytes':len(raw),'removedTriangles':len(source)}
        dest.with_suffix('.json').write_text(json.dumps(manifest,indent=2))
    report['assets'].append({'input':str(src.relative_to(ROOT)),'output':str(dest.relative_to(ROOT)),'removedTriangles':len(source),'retainedBuildingTriangles':len(keep)//3,'sourceMatchedExactlyOnce':True,'originalBinaryPreserved':True,'sha256':hashlib.sha256(result).hexdigest()})
report['status']='passed';folder=ROOT/('output/mobile-boston-replacements' if args.mobile_only else 'output/mit-residences-20261023');folder.mkdir(parents=True,exist_ok=True);(folder/('residences-base-removal-report.json' if args.mobile_only else 'base-removal-report.json')).write_text(json.dumps(report,indent=2))
print(json.dumps(report))
