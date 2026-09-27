"""Extract stable facade planes for an approximate, photo-referenced detail layer."""
import importlib,json,zipfile,numpy as np
m=importlib.import_module('prepare-campus-data')
origin=m.project(*m.CONFIG['mit']['center']); records=[]; dome=None
with zipfile.ZipFile(next(m.SOURCE.glob('mit/G4/*Bulding*'))) as z:
 for model in ['CAM_PX4ND-TBOZP-3FRN5','CAM_NCSVT-TQ9F9-BG2NN','CAM_WP4AV-34RPJ-DGCTC','CAM_IVRJC-BXJZD-X6ABS','CAM_CQMYN-XKY6H-I7J3C','CAM_CW7MH-H5BCN-PPGCW','CAM_ME1KO-1JBIG-12R97','CAM_MNJTM-TPVUN-KZN3Z','CAM_TLJEH-BZQZ7-XG4P4','CAM_KHMI4-9TDEE-EZ75Q']:
  path=next(n for n in z.namelist() if model in n and n.endswith('.obj'))
  v,f=m.obj(z.read(path),origin);tri=v[f];norm=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);area=np.linalg.norm(norm,axis=1)/2;norm/=np.maximum(area[:,None]*2,1e-9)
  if model=='CAM_PX4ND-TBOZP-3FRN5':
   ring=v[np.abs(v[:,1]-37.52)<.012];center=(ring[:,[0,2]].min(0)+ring[:,[0,2]].max(0))/2
   profile=[]
   for y in sorted(set(np.round(v[:,1],2))):
    if y<28:continue
    points=v[np.abs(v[:,1]-y)<.012];radii=np.linalg.norm(points[:,[0,2]]-center,axis=1)
    profile.append([float(np.max(radii)),float(y)])
   dome={'center':center.tolist(),'base':27.02484,'radius':19.15,'profile':profile}
  groups={}
  for i,n in enumerate(norm):
   if abs(n[1])>.01 or area[i]<1:continue
   d=float(np.dot(n,tri[i,0]));key=(round(float(n[0]),2),round(float(n[2]),2),round(d,1));groups.setdefault(key,[]).append(i)
  for key,inds in groups.items():
   if sum(area[inds])<100:continue
   n=norm[inds[0]];t=np.array([n[2],0,-n[0]]);points=tri[inds].reshape(-1,3);a,b=float((points@t).min()),float((points@t).max());bottom,top=float(points[:,1].min()),float(points[:,1].max())
   if top-bottom<8 or b-a<10:continue
   d=float(np.dot(n,points[0]));center=n*d+t*((a+b)/2)
   surface=[[[float(p@t-(a+b)/2),float(p[1])] for p in triangle] for triangle in tri[inds]]
   records.append({'model':model,'center':center.tolist(),'normal':n.tolist(),'width':b-a,'bottom':bottom,'top':top,'surface':surface,'portico':model=='CAM_PX4ND-TBOZP-3FRN5' and bool(n[2]>.85)})
out=m.ROOT/'public/data/killian';out.mkdir(parents=True,exist_ok=True)
(out/'facades.json').write_text(json.dumps({'facades':records,'dome':dome,'accuracy':'Approximate repeated details on measured facade planes; not a surveyed facade reconstruction.'},indent=2))
print({'models':len(set(r['model'] for r in records)),'facades':len(records)})
