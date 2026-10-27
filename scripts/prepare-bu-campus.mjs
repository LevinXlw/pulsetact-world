import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const source = new URL('../assets-source/charles-bu/', import.meta.url);
await mkdir(source, { recursive: true });
const endpoint = 'https://gis.boston.gov/arcgis/rest/services/Assessing/DOIT_buildings/MapServer/2';
if (process.argv.includes('--download')) {
  const parameters = new URLSearchParams({ f: 'json', where: "IEL_TYPE = 'BLDG'", geometry: '-71.134,42.344,-71.093,42.3565', geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', returnZ: 'false', returnM: 'false', orderByFields: 'OBJECTID', resultRecordCount: '2000' });
  const response = await fetch(`${endpoint}/query?${parameters}`);
  if (!response.ok) throw new Error(`Boston GIS ${response.status}`);
  const data = await response.json();
  if (data.error || data.exceededTransferLimit) throw new Error(JSON.stringify(data.error ?? 'Truncated results'));
  await writeFile(new URL('boston-buildings-bu-area.json', source), JSON.stringify(data));
  console.log(`Downloaded ${data.features.length} City of Boston building features`);
}
if(process.argv.includes('--download')||process.argv.includes('--download-east')){
  // A narrow Beacon Street extension reaches Danielsen without importing the
  // rest of Back Bay. Keep the source extract separate for reproducibility.
  const parameters=new URLSearchParams({f:'json',where:"IEL_TYPE = 'BLDG'",geometry:'-71.0945,42.3494,-71.0895,42.3515',geometryType:'esriGeometryEnvelope',inSR:'4326',outSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:'true',returnZ:'false',returnM:'false',orderByFields:'OBJECTID',resultRecordCount:'2000'});
  const response=await fetch(`${endpoint}/query?${parameters}`);
  if(!response.ok)throw new Error(`Boston GIS east ${response.status}`);
  const data=await response.json();if(data.error||data.exceededTransferLimit)throw new Error(JSON.stringify(data.error??'Truncated east results'));
  await writeFile(new URL('boston-buildings-bu-east.json',source),JSON.stringify(data));
  console.log(`Downloaded ${data.features.length} Beacon Street source features`);
}
if (process.argv.includes('--references')) {
  await mkdir('output/bu-survey',{recursive:true});
  for(const [name,url] of [['law-plan','https://www.bu.edu/community/files/2012/06/FinalPNF-EENF6-15-12Small.pdf'],['new-balance-plan','https://www.bu.edu/community/files/2012/03/New-Balance-Field-PNF.pdf'],['campus-map','https://www.bu.edu/sargent/files/2013/11/BUmap.pdf'],['campus-2023','https://www.bu.edu/community/files/2022/11/2023-2033-BU-CRC-IMPNF.pdf'],['nickerson-2025','https://www.bu.edu/commencement/files/2025/05/CMCT_RedBook2025_Final.pdf']]){
    const response=await fetch(url);if(!response.ok)throw new Error(`${name} ${response.status}`);await writeFile(`output/bu-survey/${name}.pdf`,Buffer.from(await response.arrayBuffer()));
  }
}
const city = JSON.parse(await readFile(new URL('boston-buildings-bu-area.json', source), 'utf8'));
const eastCity=JSON.parse(await readFile(new URL('boston-buildings-bu-east.json',source),'utf8'));
const mainQueryCount=city.features.length;
city.features=[...new Map([...city.features,...eastCity.features].map(f=>[f.attributes.OBJECTID,f])).values()];
const projectionSource = await readFile(new URL('../src/features/world/geo-coordinates.ts', import.meta.url), 'utf8');
const projection = ts.transpileModule(projectionSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { geoToWorld } = await import('data:text/javascript;base64,' + Buffer.from(projection).toString('base64'));
const foot = 1200 / 3937, round = v => Math.round(v * 1000) / 1000;
const mean = p => [p.reduce((s,p)=>s+p[0],0)/p.length,p.reduce((s,p)=>s+p[1],0)/p.length];
const area = r => r.reduce((sum,p,i)=>{const q=r[(i+1)%r.length];return sum+p[0]*q[1]-p[1]*q[0];},0)/2;
const within = (p,ring) => { let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit; };
function orientedBox(points) {
  // The minimum-area rectangle is metadata only. Rendering retains the polygon.
  let best;
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length],angle=Math.atan2(q[1]-p[1],q[0]-p[0]),c=Math.cos(angle),s=Math.sin(angle);
    const u=points.map(p=>p[0]*c+p[1]*s),v=points.map(p=>-p[0]*s+p[1]*c);
    const u0=Math.min(...u),u1=Math.max(...u),v0=Math.min(...v),v1=Math.max(...v),width=u1-u0,depth=v1-v0;
    if(!best||width*depth<best.size){const uc=(u0+u1)/2,vc=(v0+v1)/2;best={x:uc*c-vc*s,z:uc*s+vc*c,width,depth,yaw:-angle,size:width*depth};}
  }
  if(best.width<best.depth){[best.width,best.depth]=[best.depth,best.width];best.yaw-=Math.PI/2;}
  while(best.yaw>Math.PI/2)best.yaw-=Math.PI;while(best.yaw<=-Math.PI/2)best.yaw+=Math.PI;
  delete best.size;return Object.fromEntries(Object.entries(best).map(([k,v])=>[k,round(v)]));
}
// Identity checks use OBJECTID, not parcel/building ID: the city's joined address
// table repeats parcel IDs across several separate real building footprints.
const named = {
  1362: ['com','College of Communication','academic'],
  1363: ['warren-services','Warren Towers service wing','academic'],
  1369: ['metcalf-science','Metcalf Science Center','academic'],
  1372: ['commonwealth-560','560 Commonwealth Avenue commercial building','context'],
  1373: ['commonwealth-566','Kenmore Tower / 566 Commonwealth Avenue','context'],
  // BU Housing/2023 IMP identify this otherwise addressless City record.
  1374: ['commonwealth-580','580 Commonwealth Avenue graduate apartments','residence',35.357],
  1841: ['warren-towers','Warren Towers','residence',60.2],
  1842: ['cas-east','College of Arts & Sciences / Tsai Performance Center','historic'],
  1844: ['the-towers','The Towers residence','residence'],
  1845: ['questrom','Questrom School of Business','academic',53.05,true],
  1848: ['commonwealth-585','585 Commonwealth Avenue','academic'],
  2257: ['student-services-west','881 Commonwealth Avenue / Student Services','academic'],
  2322: ['gsu-mugar','George Sherman Union / Mugar Memorial Library','library',17.92],
  2323: ['bu-academy','Boston University Academy','historic'],
  2723: ['bu-police','Boston University Police / Braves Field ticket office','historic'],
  2724: ['stuvi-one','10 Buick Street / Student Village I','stuvi',65.81],
  2793: ['agganis','Agganis Arena','arena',19.34],
  2794: ['fitrec','Fitness & Recreation Center','fitrec',20.47],
  3287: ['student-athlete-support','300 Babcock Street / Student-Athlete Support Center','academic'],
  3658: ['track-tennis','Track & Tennis Center','arena'],
  3659: ['case-center','Case Physical Education Center / Walter Brown Arena','arena',18.108],
  3660: ['athletics-west','120 Ashford Street / Athletics','academic'],
  9741: ['marsh-sth','Marsh Chapel / School of Theology','historic',null,true],
  11603: ['engineering-life-sciences','Life Science & Engineering Building','academic'],
  11605: ['engineering-research','Engineering research laboratories','academic'],
  11641: ['photonics','Photonics Center','photonics',50.32],
  124674: ['kilachand-hall','Kilachand Hall','historic'],
  124682: ['cfa','College of Fine Arts','historic'],
  124683: ['cgs','College of General Studies','historic'],
  124691: ['buick-offices','25 Buick Street / University Offices','academic'],
  124707: ['west-dining','West Campus Dining Hall','academic',6.2],
  124710: ['stuvi-south-tower','Student Village South Tower','residence',64.04],
  124711: ['stuvi-north-tower','Student Village North Tower','residence',91.68],
  124712: ['stuvi-north-core','Student Village North Tower service core','residence',90.28],
  128488: ['stuvi-north-connectors','Student Village North Tower connecting wings','residence',86.11],
  12550: ['castle','Dahod Family Alumni Center at the Castle','historic',null,true],
  12551: ['leventhal','Alan & Sherry Leventhal Center','historic'],
  12187: ['hillel','Florence & Chafetz Hillel House','historic'],
  12066: ['sargent','Sargent College','academic'],
  13000: ['residence-1019','1019 Commonwealth Avenue residence','residence'],
  12828: ['danielsen-east-wing','Danielsen Hall east wing','residence'],
  127716: ['danielsen-hall','Danielsen Hall','residence'],
};
const all = city.features.map(f=>{
  const a=f.attributes;
  const rings=f.geometry.rings.map(r=>{const p=r.map(([lon,lat])=>geoToWorld(lat,lon).map(round));if(p.length>3&&Math.hypot(p[0][0]-p.at(-1)[0],p[0][1]-p.at(-1)[1])<.02)p.pop();return p;}).filter(r=>r.length>=3).sort((a,b)=>Math.abs(area(b))-Math.abs(area(a)));
  const footprint=rings[0], centre=mean(footprint), geo=mean(f.geometry.rings[0]);
  return {a,footprint,rings,centre,geo,owned:/BOSTON UNIV/.test(a.PART_CONTACT||''),named:named[a.OBJECTID]};
});
const inMain=f=>f.geo[0]>-71.1249&&f.geo[0]<-71.094&&f.geo[1]>42.3464&&f.geo[1]<42.3549;
const inEast=f=>f.geo[0]>=-71.094&&f.geo[0]<-71.0897&&f.geo[1]>42.3495&&f.geo[1]<42.3513;
// Recover only the reviewed opposite-Questrom buildings; do not silently expand
// the old 58 m context selection around these late identity corrections.
const recoveredIds=new Set([1372,1373,1374]);
const primary=all.filter(f=>(f.owned||(f.named&&!recoveredIds.has(f.a.OBJECTID)))&&(inMain(f)||inEast(f)));
const selected=all.filter(f=>recoveredIds.has(f.a.OBJECTID)||primary.includes(f)||((inMain(f)||inEast(f))&&primary.some(p=>Math.hypot(p.centre[0]-f.centre[0],p.centre[1]-f.centre[1])<58))||(inEast(f)&&/BEACON ST/.test(f.a.PART_ADDRESS||'')));
// 278 Babcock was demolished for the New Balance Field / Langsam Garage project.
const buildings=selected.filter(f=>Math.abs(area(f.footprint))>22&&f.a.OBJECTID!==3218).map(f=>{
  const a=f.a,address=a.OBJECTID===1374?'580 Commonwealth Avenue':(a.PART_ADDRESS||'').trim(),identity=f.named;
  const old=a.BUILDING_HEIGHT_2010*foot,current=a.TOP_GROUND_LEVEL*foot;
  let height=old>2&&old<130?old:current>2&&current<130?current:Math.max(8,Number(a.PART_FLOORS)||3)*3.25;
  let heightField=old>2&&old<130?'BUILDING_HEIGHT_2010':current>2&&current<130?'TOP_GROUND_LEVEL':'estimated';
  if(identity?.[3]){height=identity[3];heightField='reviewed-landmark-height';}
  const brownstone=/BAY STATE|BUSWELL|MOUNTFORT|BEACON/.test(address)&&height<28&&Math.abs(area(f.footprint))<1400;
  return {id:identity?.[0]??`boston-${a.OBJECTID}`,name:identity?.[1]??(address||`Campus vicinity building ${a.OBJECTID}`),address,kind:identity?.[2]??(brownstone?'brownstone':f.owned?'academic':'context'),...orientedBox(f.footprint),height:round(height),groundElevation:a.BASE_ELEVATION>0?round(a.BASE_ELEVATION*foot):a.GROUND_ELEVATION_2010>0?round(a.GROUND_ELEVATION_2010*foot):null,heightSource:heightField==='estimated'?'estimated':'city-gis',heightField,cityObjectId:a.OBJECTID,universityOwned:f.owned||!!identity&&identity[2]!=='context',footprint:f.footprint,...(f.rings.length>1?{holes:f.rings.slice(1).filter(r=>within(r[0],f.footprint))}:{}),...(identity?.[4]?{custom:true}:{})};
});
// Only this addressless City record receives the verified BU identity/height.
const commonwealth580=buildings.find(b=>b.id==='commonwealth-580');
Object.assign(commonwealth580,{heightSource:'official-bu',heightField:'BU 2023-2033 IMP: 116 ft; 11 above-ground floors',footprintSource:'Boston GIS 1374 unchanged ground envelope; upper floor separation: 580-commonwealth/source-20261027.json'});
// The city stores the Sert complex as one footprint. The narrow law tower is
// identifiable within its eastern outline and in BU's 2012 site plan (Fig 1-3).
// Keep the low complex, then express this distinct vertical component separately.
const sert=buildings.find(b=>b.id==='gsu-mugar');
const lawRing=[...sert.footprint.slice(12,25),...sert.footprint.slice(36,44)];
buildings.push({...sert,id:'law-tower',name:'School of Law Tower',address:'765 Commonwealth Avenue',kind:'law',...orientedBox(lawRing),height:79.962,heightField:'TOP_GROUND_LEVEL (tower within combined city footprint)',footprint:lawRing});
// BU's 2025 commencement site map distinguishes Rich Hall from the contiguous
// Case Center, and Claflin/Sleeper towers from their low curved dining link.
const caseBuilding=buildings.find(b=>b.id==='case-center'),caseOriginal=caseBuilding.footprint;
const richRing=caseOriginal.slice(54,67);
caseBuilding.footprint=[...caseOriginal.slice(0,55),...caseOriginal.slice(66)];
Object.assign(caseBuilding,orientedBox(caseBuilding.footprint));
buildings.push({...caseBuilding,id:'rich-hall',name:'Rich Hall',address:'277 Babcock Street',kind:'residence',...orientedBox(richRing),height:45.15,heightField:'TOP_GROUND_LEVEL (Rich Hall within combined city footprint)',footprint:richRing});
const west=buildings.find(b=>b.id==='west-dining'),westOriginal=west.footprint;
for(const [id,name,address,ring,frame] of [
  // Include the existing neck vertex 10 in the closing join. The old 11–25
  // chord crossed the outside of the City ring by a narrow triangular sliver.
  // Retain the tower's original placement metadata/terrain sample unchanged.
  ['claflin-hall','Claflin Hall','273 Babcock Street',westOriginal.slice(10,26),westOriginal.slice(11,26)],
  ['sleeper-hall','Sleeper Hall','275 Babcock Street',westOriginal.slice(54,71)],
])buildings.push({...west,id,name,address,kind:'residence',...orientedBox(frame??ring),height:43.79,heightField:'TOP_GROUND_LEVEL (tower within combined city footprint)',footprint:ring});
// The two extracted tower rings must also leave the low dining footprint.
// Otherwise its full-height brick wall fills their lobby windows and renders
// coplanar with the tower masonry. The three components still partition the
// unchanged City ring; their two shared closing chords are internal joins.
// Keep the old terrain reference because legacy western ground pads/samples
// must not move when a compound survey record is separated into components.
west.terrainReference={anchor:[west.x,west.z],footprint:westOriginal};
west.footprint=[...westOriginal.slice(0,11),...westOriginal.slice(25,55),...westOriginal.slice(70)];
Object.assign(west,orientedBox(west.footprint));
west.footprintSource='city-gis-124707 dining remainder after unchanged Claflin/Sleeper component extraction; west-dining-separation-20261026.json';
// Modern buildings absent from the older city survey or outside Boston. These are explicitly authored
// envelopes located from BU's address/site descriptions, not surveyed polygons.
const recent=[
  {id:'kilachand-center',name:'Rajen Kilachand Center for Integrated Life Sciences & Engineering',address:'610 Commonwealth Avenue',x:-769,z:1137,width:40,depth:41,yaw:-.157,height:39},
  {id:'booth-theatre',name:'Joan & Edgar Booth Theatre / CFA Production Center',address:'820 Commonwealth Avenue',x:-1680,z:1010,width:66,depth:53,yaw:-.155,height:17.5},
  {id:'yawkey-center',name:'Yawkey Center for Student Services / Marciano Commons',address:'100 Bay State Road',x:-491,z:1037,width:44,depth:42,yaw:-.10,height:23.5},
];
// Keep estimated envelopes on their side of adjacent surveyed facades. These
// constraints trim only the authored shape; the City's geometry never moves.
const neighborFacades={
  'kilachand-center':[[[-787.280,1151.467],[-738.898,1159.146]]],
  'yawkey-center':[[[-509.794,1015.721],[-511.181,1030.803]],[[-507.373,1057.450],[-474.378,1062.872]]],
};
// BU's published campus map puts Booth east of the main CFA block, beside
// 808 Commonwealth. CPO describes a north plaza and south Dummer landscape
// buffer. These constraints use unchanged MassGIS axes; setbacks and envelope
// remain authored estimates. Bay State's sidewalk must also stay outside Yawkey.
const streetClearances={
  'booth-theatre':[
    {line:[[-1786.373,937.117],[-1660.821,956.232]],clearance:19.6},
    {line:[[-1801.962,1041.559],[-1679.926,1062.110]],clearance:14.7},
  ],
  'yawkey-center':[{line:[[-505.926,1000.018],[-460.309,1004.077]],clearance:13.2}],
};
function clipAtNeighbor(ring,line,center,clearance=1){
  const[a,b]=line,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
  const raw=p=>(dx*(p[1]-a[1])-dz*(p[0]-a[0]))/length,sign=Math.sign(raw(center));
  const distance=p=>raw(p)*sign-clearance,result=[];
  for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length],dp=distance(p),dq=distance(q);if(dp>=0)result.push(p);if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);result.push([round(p[0]+t*(q[0]-p[0])),round(p[1]+t*(q[1]-p[1]))]);}}
  return result;
}
for(const b of recent){
  const c=Math.cos(b.yaw),s=Math.sin(b.yaw);
  let footprint=[[-b.width/2,-b.depth/2],[b.width/2,-b.depth/2],[b.width/2,b.depth/2],[-b.width/2,b.depth/2]].map(([x,z])=>[round(b.x+x*c+z*s),round(b.z-x*s+z*c)]);
  for(const line of neighborFacades[b.id]??[])footprint=clipAtNeighbor(footprint,line,[b.x,b.z]);
  for(const constraint of streetClearances[b.id]??[])footprint=clipAtNeighbor(footprint,constraint.line,[b.x,b.z],constraint.clearance);
  buildings.push({...b,...orientedBox(footprint),groundElevation:null,kind:'academic',heightSource:'estimated',heightField:'authored envelope based on documented floor count',cityObjectId:0,universityOwned:true,footprintSource:'authored approximation from official BU campus map and site descriptions; constrained by unchanged street axes and adjacent surveyed facades',footprint});
}
const spaces=[
  {id:'nickerson',name:'Nickerson Field',lat:42.35346,lon:-71.11919,width:106.07,depth:65.84,yaw:.57,kind:'soccer',source:'BU Athletics pitch dimensions; centre/orientation interpreted from BU 2012 aerial site plan'},
  {id:'new-balance',name:'New Balance Field / Langsam Garage',lat:42.35348,lon:-71.12190,width:130,depth:82,yaw:-.155,kind:'field-hockey',source:'BU New Balance Field 2012 PNF, field/parking level plans; footprint fitted inside MassDOT Babcock/Alcorn/Gardner/Ashford centre lines'},
  {id:'softball',name:'BU Softball Field',lat:42.35363,lon:-71.12418,width:74,depth:72,yaw:-.155,kind:'softball',source:'BU campus map and 2012 PNF aerial, approximate play area'},
].map(({lat,lon,...s})=>{const[x,z]=geoToWorld(lat,lon);return {...s,x:round(x),z:round(z)};});
const bounds={minX:Math.floor(Math.min(...buildings.flatMap(b=>b.footprint.map(p=>p[0])))-35),maxX:Math.ceil(Math.max(...buildings.flatMap(b=>b.footprint.map(p=>p[0])))+35),minZ:Math.floor(Math.min(...buildings.flatMap(b=>b.footprint.map(p=>p[1])))-35),maxZ:Math.ceil(Math.max(...buildings.flatMap(b=>b.footprint.map(p=>p[1])))+35)};
const sourceNote={retrieved:'2026-10-15',source:endpoint,sourceSpatialReference:'NAD83 / Massachusetts Mainland (US feet); query returned WGS84',coordinates:'Shared MIT/Boston local metres, x east / z south; geographic origin 42.35915,-71.09205',queryCount:city.features.length,selectedCount:buildings.length,universityOwnedOrNamed:buildings.filter(b=>b.universityOwned).length,contextCount:buildings.filter(b=>!b.universityOwned).length,scope:'Charles River Campus, West Campus and South Campus vicinity; not Medical Campus or Fenway Campus',heightPolicy:'Use per-footprint BUILDING_HEIGHT_2010 in US feet where available. New TOP_GROUND_LEVEL values are repeated across many parcel joins and do not reliably represent each roof. Reviewed towers/arenas use individually checked top/2010 values. Facades and interior mass subdivisions remain authored approximations.',groundPolicy:'BASE_ELEVATION preserved in metres NAVD88; not itself a complete terrain surface.',references:['https://maps.bu.edu/?id=647','https://www.bu.edu/sargent/files/2013/11/BUmap.pdf','https://www.bu.edu/parentsprogram/files/2020-boston-university-calendar-ISSUU.pdf','https://www.bu.edu/cpo/what-we-do/buildings/'],notes:['City data has no guarantee of currency. Addresses and building IDs repeat across multiple shapes, so the OBJECTID keys are retained.','Context footprints do not imply BU ownership. Ownership comes from source PART_CONTACT or a positively identified BU facility.','Existing Marsh/STH, Castle and Questrom authored landmark renderers are retained and marked custom. CDS postdates the source survey and remains in its existing authored renderer.']};
sourceNote.uniqueCityFootprints=new Set(buildings.filter(b=>b.cityObjectId).map(b=>b.cityObjectId)).size;
sourceNote.sourceExtracts=[{file:'boston-buildings-bu-area.json',count:mainQueryCount,bounds:'-71.134,42.344,-71.093,42.3565'},{file:'boston-buildings-bu-east.json',count:eastCity.features.length,bounds:'-71.0945,42.3494,-71.0895,42.3515'}];
sourceNote.references.push('https://www.bu.edu/housing/residence/large-traditional-style-residences/danielsen-hall/');
sourceNote.notes.push('The narrow East Campus extension includes Danielsen Hall at 512 Beacon Street, its separate City footprint wing, nearby BU-owned parcels, and Beacon Street row-house context. It does not model all of Back Bay.');
sourceNote.authoredModernEnvelopes=recent.map(b=>b.name);
sourceNote.authoredEnvelopeReview={reviewed:'2026-10-16',sources:['https://www.bu.edu/parentsprogram/files/2020-boston-university-calendar-ISSUU.pdf','https://www.bu.edu/cpo/project/booth-theatre-and-cfa-production-center/','https://www.bu.edu/cfa/venues-facilities/joan-edgar-booth-theatre/','https://www.bu.edu/cpo/project/yawkey-center-for-student-services/'],notes:['Booth is in Brookline, beyond the Boston footprint survey. Its previously authored envelope overlapped Commonwealth Avenue. The corrected approximate envelope sits south of the avenue, east of the main CFA block, with the documented plaza and Dummer Street buffer. This is interpreted from BU map/site descriptions, not a recovered Brookline survey.','Yawkey retains the documented Bay State/Deerfield site while its approximate north edge is set back from Bay State and its west/south sides are clipped clear of neighboring surveyed facades.','Kilachand Center retains its existing street-clear envelope. No City footprint or MassGIS road is translated. Brookline GIS query was attempted but its live server was unreachable on the review date.']};
sourceNote.references.push('https://www.bu.edu/reservations/25live/building-codes/','https://www.bu.edu/community/files/2012/06/FinalPNF-EENF6-15-12Small.pdf','https://www.bu.edu/community/files/2012/03/New-Balance-Field-PNF.pdf','https://www.bu.edu/commencement/files/2025/05/CMCT_RedBook2025_Final.pdf','https://www.bu.edu/cpo/project/center-for-integrated-life-sciences-engineering/','https://www.bu.edu/articles/2017/new-joan-edgar-booth-theatre-opens/','https://www.bu.edu/cpo/project/yawkey-center-for-student-services/');
sourceNote.notes.push('Counts are building components, not independent university buildings: Law/Rich/Claflin/Sleeper tower components share source footprints with their lower connected buildings.','Kilachand Center, Booth Theatre and Yawkey Center are authored approximate envelopes, absent from the older Boston source geometry; Booth is also outside Boston in Brookline. Their heights are estimates informed by documented floor counts, not measurements. Ground elevation is null so they do not masquerade as terrain observations.','Nickerson, New Balance and softball field centres/orientations are manually interpreted from official BU plans. The New Balance envelope includes the field-top Langsam Garage block.');
sourceNote.notes.push('2026-10-26: West Dining now uses only the remainder of City footprint 124707 after extracting Claflin/Sleeper. The three component footprints preserve the original outer boundary and occupied area; terrainReference retains the original terrain sample/pad and dining foundation. See west-dining-separation-20261026.json.');
sourceNote.notes.push("2026-10-27: Recovered opposite-Questrom frontage City 1374 (580 Commonwealth, verified BU graduate housing) and 1373 (566 Commonwealth, private Kenmore Tower). Their real polygons were excluded by owner/address and 58 m centroid filtering. Separate dedicated builders distinguish ground envelopes from upper floors; no other selected footprint is regenerated.");
sourceNote.references.push("https://www.bu.edu/housing/residence/central-campus-graduate-apartments/580-commonwealth-avenue/","https://www.bu.edu/community/files/2022/11/2023-2033-BU-CRC-IMPNF.pdf");
sourceNote.notes.push("2026-10-27: Separately recovered City 1372, the private low commercial building at 560 Commonwealth east of Kenmore Tower. Its 38-point source ring remains independent; no tower footprint merge or inferred parcel-wide paving is introduced. See 560-commonwealth/source-20261027.json.");
await writeFile(new URL('bu-campus-source-manifest.json',source),JSON.stringify(sourceNote,null,2)+'\n');
await writeFile(new URL('bu-selected-building-index.json',source),JSON.stringify(buildings.map(({footprint,holes,...b})=>b),null,2)+'\n');
const header=`/** Generated by scripts/prepare-bu-campus.mjs. City of Boston GIS footprints, retrieved 2026-10-15.\n * Real shared metre coordinates; no visual stretching. Context buildings are not all BU-owned.\n * Heights and NAVD88 ground observations retain provenance; see assets-source/charles-bu/bu-campus-source-manifest.json. */\nimport type { WorldPoint } from './geo-coordinates';\nexport type BUCampusBuilding = { id:string; name:string; address:string; kind:'historic'|'academic'|'residence'|'arena'|'law'|'stuvi'|'photonics'|'fitrec'|'garage'|'brownstone'|'library'|'context'; x:number; z:number; width:number; depth:number; yaw:number; height:number; groundElevation:number|null; heightSource:'city-gis'|'official-bu'|'estimated'; heightField:string; cityObjectId:number; universityOwned:boolean; footprint:WorldPoint[]; holes?:WorldPoint[][]; custom?:boolean; footprintSource?:string; terrainReference?:{anchor:WorldPoint;footprint:WorldPoint[]} };\nexport const BU_FULL_BOUNDS = ${JSON.stringify(bounds)};\nexport const BU_FULL_BUILDINGS: BUCampusBuilding[] = [\n`;
const footer=`\nexport type BUCampusSpace = {id:string;name:string;x:number;z:number;width:number;depth:number;yaw:number;kind:'soccer'|'field-hockey'|'softball';source:string};\nexport const BU_FULL_SPACES: BUCampusSpace[] = ${JSON.stringify(spaces)};\n\n/** Actual footprints, including courtyards, with optional walking clearance. */\nexport function isInsideBUCampusBuilding(x:number,z:number,padding=0):boolean {\n  const inside=(ring:WorldPoint[])=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};\n  return BU_FULL_BUILDINGS.some(b=>{\n    if(Math.hypot(x-b.x,z-b.z)>Math.hypot(b.width,b.depth)/2+padding+2)return false;\n    if(inside(b.footprint)&&!(b.holes??[]).some(inside))return true;\n    if(padding<=0)return false;\n    return [b.footprint,...(b.holes??[])].some(r=>r.some((a,i)=>{const c=r[(i+1)%r.length],dx=c[0]-a[0],dz=c[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<padding;}));\n  });\n}\n`;
await writeFile(new URL('../src/features/world/bu-full-layout.ts',import.meta.url),header+buildings.map(b=>JSON.stringify(b)).join(',\n')+'\n];\n'+footer);
console.log(JSON.stringify({buildings:buildings.length,bounds,universityOwnedOrNamed:sourceNote.universityOwnedOrNamed,contextCount:sourceNote.contextCount,spaces}));
if (process.argv.includes('--survey')) {
  const { default: sharp } = await import('sharp');
  await mkdir('output/bu-survey',{recursive:true});
  for(const [name,b] of [['central',[-71.110,42.3501,-71.1035,42.3516]],['west',[-71.1245,42.3513,-71.115,42.355]]]) {
    const w=1400,h=Math.round((b[3]-b[1])/(b[2]-b[0])*1400/.738);
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f8f4e9"/>`;
    const pt=p=>[(p[0]-b[0])/(b[2]-b[0])*w,(b[3]-p[1])/(b[3]-b[1])*h];
    for(const f of city.features){const r=f.geometry.rings[0],[x,y]=mean(r);if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;svg+=`<polygon points="${r.map(p=>pt(p).join(',')).join(' ')}" fill="#ddd4b9" stroke="#67695c" stroke-width="1"/>`;const p=pt([x,y]);svg+=`<text x="${p[0]}" y="${p[1]}" font-size="13" text-anchor="middle">${f.attributes.OBJECTID}</text>`;}
    svg+='</svg>';await sharp(Buffer.from(svg)).png().toFile(`output/bu-survey/${name}.png`);
  }
}
