from pathlib import Path
import json,struct,collections
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
ns={'__file__':str(HERE/'extract-entry-terrain.py')}
exec((HERE/'extract-entry-terrain.py').read_text().split('triangles=[]')[0],ns)
doc,acc,local=ns['doc'],ns['acc'],ns['local'];ts=[]
for mesh in doc['meshes']:
 for p in mesh['primitives']:
  if doc['materials'][p['material']].get('name')!='Cambridge buildings (untextured)':continue
  vs=acc(p['attributes']['POSITION']);ix=[x[0] for x in acc(p['indices'])] if 'indices' in p else list(range(len(vs)))
  for k in range(0,len(ix),3):
   ps=[local(vs[ix[k+j]]) for j in range(3)]
   if all(-45<a[0]<35 and -22<a[1]<25 and -2<a[2]<4.5 for a in ps):ts.append(ps)
(HERE/'entry-source-walls.json').write_text(json.dumps(ts,indent=2))
print('triangles',len(ts),'heights',collections.Counter(round(p[2],3) for t in ts for p in t))
print('vertices',sorted(set(tuple(round(q,3) for q in p) for t in ts for p in t)))
