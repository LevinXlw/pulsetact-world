import fs from 'node:fs';
import crypto from 'node:crypto';
const root=new URL('./',import.meta.url);
const target=new URL('../../../public/assets/characters/sakurada/',root);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const inspection=JSON.parse(fs.readFileSync(new URL('runtime-inspection.json',root)));
const source={
  sha256:inspection.sha256,
  name:'Sakurada Fumiriya / 桜田 史利矢',author:'VRoid Project / pixiv Inc.',checkedAt:'2026-10-11',
  officialModel:'https://hub.vroid.com/en/characters/6912965120285194650/models/2261505926203110716',
  officialLicenseStatement:'https://vroid.pixiv.help/hc/en-us/articles/360014788554-Sakurada-Fumiriya',
  downloadPage:'https://opengameart.org/content/vroid-studio-cc0-models',
  downloadUrl:'https://opengameart.org/sites/default/files/sakurada_fumiriya.zip',
  downloadProvenance:'Publicly redistributed VRoid Project model. Downloaded from OpenGameArt mirror; author and model name checked against embedded VRM metadata and official model page.',
  archiveSha256:hash(new URL('sakurada_fumiriya.zip',root)),
  originalSha256:hash(new URL('original/Sakurada Fumiriya.vrm',root)),
  officialCharacterLicense:'CC0-1.0 per pixiv official character FAQ',
  embeddedLicense:inspection.meta,
  licenseNote:'The downloaded Hub-version file embeds licenseName Other and a model-specific Hub license URL allowing corporate and individual commercial use, modification and redistribution, with attribution not required. The official character FAQ separately states CC0. The embedded license has not been rewritten to CC0; only the obsolete thumbnail reference was removed when optimizing images.',
  animations:{name:'Quaternius Universal Animation Library Standard',license:'CC0-1.0',source:'https://quaternius.com/packs/universalanimationlibrary.html',sourceSha256:'69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997',clips:['Idle','Walk','Run','Sprint','Seated']},
  modifications:[
    'Retargeted and baked five CC0 UAL actions using VRM 0 humanoid bone correspondence; source motion rotated to match native -Z facing.',
    'Kept original mesh vertex, normal, UV, morph, joint, weight and inverse-bind data.',
    'Resized face albedo to at most 1024px and other runtime albedos to at most 512px; removed maps unused by the standard unlit glTF fallback.',
    'Merged equal-material primitives sharing identical vertex and morph data: 102 primitives reduced to 17.',
    'Removed legacy COLOR_0 semantic containing black/transparent vertices: MToon ignores it while standard glTF multiplies it into albedo and alpha.',
    'Converted original MToon sRGB color factors to linear glTF baseColorFactor, correcting legacy exporter behavior before UniVRM v0.54.',
    'Retained model-specific author and usage metadata; removed only the unused thumbnail index.'
  ],
  appearance:'White short sleeve shirt, navy knitted vest, orange-red tie, black trousers and shoes. Peach/light-brown outer hair and purple lower hair from original palette.',
  runtime:{file:'sakurada.glb',bytes:inspection.bytes,sha256:inspection.sha256,triangles:inspection.triangles,primitives:inspection.primitives,materials:inspection.materials,faceMorphTargets:39,facing:'-Z',restBounds:{min:[-0.780419469,0.000405811938,-0.176197216],max:[0.7819644,1.90897429,0.1769975]},restHeightMeters:1.908568478062,runtimeTextureRgbaWithMipsMiB:18.6667},
  validation:{blender:'Imported final standard glTF; rendered and visually inspected Idle, Walk and Run. Face, clothing and hair visible; knees and elbows bend naturally.',sourceGeometryPreserved:true,sourceMetaPreservedExceptThumbnail:true},
  alternateMirror:{url:'https://github.com/madjin/vrm-samples/blob/master/vroid/beta/Sakurada_Fumiriya.vrm',sha256:'d8fb05f33e377df028cb6b9d58c441ce68326c41fa23f6c735d40c65ae3dc710',embeddedLicense:'CC0',usedForRuntime:false,note:'Older 112-node version inspected only as an independent material/reference comparison; it is not the same binary as the 122-node Hub version used here.'}
};
fs.writeFileSync(new URL('SOURCE.json',target),JSON.stringify(source,null,2)+'\n');
fs.writeFileSync(new URL('provenance.json',root),JSON.stringify(source,null,2)+'\n');
console.log(JSON.stringify(source.runtime,null,2));
