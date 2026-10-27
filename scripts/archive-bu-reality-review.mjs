import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const run='output/bu-reality-20261026';
const archive='docs/screenshots/bu-reality-20261026';
const references='assets-source/charles-bu/references/warren-20261026';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const files={};
async function preserve(from,to){await mkdir(to.slice(0,to.lastIndexOf('/')),{recursive:true});await copyFile(from,to);files[to]=await sha(to);}
const pairIds=['02-link-entry','03-mugar-south','05-warren-front','06-warren-entry'];
for(const phase of ['before','after']){
  const inputPhase=phase==='after'?'final':phase;
  await preserve(`${run}/${inputPhase}/report.json`,`${archive}/${phase}/report.json`);
  for(const id of pairIds)await preserve(`${run}/${inputPhase}/${id}.png`,`${archive}/${phase}/${id}.png`);
}
for(const id of ['10-claflin-window','11-west-residence-link','12-gsu-link-side'])await preserve(`${run}/final/${id}.png`,`${archive}/after/${id}.png`);
await preserve(`${run}/after/11-west-residence-link.png`,`${archive}/shadow-before/11-west-residence-link.png`);
await preserve(`${run}/final/report.json`,`${archive}/overview/report.json`);
await preserve(`${run}/final/09-warren-towers.png`,`${archive}/overview/09-warren-towers.png`);
const continuous=await json(`${run}/continuous/report.json`);
if(continuous.status!=='passed')throw Error('Continuous route did not pass');
await preserve(`${run}/continuous/report.json`,`${archive}/continuous/report.json`);
for(const id of ['00-gsu','01-bu-mugar','03-bu-warren','05-bu-questrom'])await preserve(`${run}/continuous/${id}.png`,`${archive}/continuous/${id}.png`);
const mobile=await json(`${run}/playable-mobile-recheck/report.json`);
if(mobile.status!=='passed')throw Error('Mobile-emulation route did not pass');
await preserve(`${run}/playable-mobile-recheck/report.json`,`${archive}/mobile/report.json`);
for(const id of ['bu-warren','bu-nickerson','mobile-gsu-link-hd','mobile-bu-hd']){
  // Destination ids have changed in older checks; an absent selected image is
  // explicitly omitted, while the complete runtime report remains required.
  try{await preserve(`${run}/playable-mobile-recheck/${id}.png`,`${archive}/mobile/${id}.png`);}catch(e){if(e.code!=='ENOENT')throw e;}
}
for(const [from,to] of [
 [`${run}/references/warren-site-022.png`,`${references}/warren-existing-aerial-p22.png`],
 ['output/bu-comm-ave-20261024/references/warren-p23.png',`${references}/warren-existing-photos-p23.png`],
 [`${run}/references/warren-plan-040.png`,`${references}/warren-roof-plan-p40.png`],
])await preserve(from,to);
const reflection=await json(`${run}/reflections/report.json`);
if(reflection.status!=='passed')throw Error('Reflection runtime validation did not pass');
await preserve(`${run}/reflections/report.json`,`${archive}/reflections/report.json`);
const sourcePaths=[
 'src/features/world/bu-full-campus.ts','src/features/world/bu-full-layout.ts','src/features/world/bu-terrain.ts',
 'src/features/world/bu-warren-tower-layout.ts','src/features/world/bu-sert-photo-facades.ts',
 'src/features/world/bu-refined-building-asset.ts','src/features/world/painterly-sky.ts','src/features/world/mobile-campus-build.ts',
 'scripts/prepare-bu-campus.mjs','scripts/prepare-mobile-campus.mjs','scripts/capture-bu-comm-ave.mjs',
 'scripts/check-bu-continuous.mjs','scripts/check-bu-playable.mjs','public/data/mobile/boston.glb','public/data/mobile/boston.json',
];
const sources={};for(const path of sourcePaths)sources[path]=await sha(path);
const exportMetrics=await json('public/data/mobile/boston.json');
const after=await json(`${run}/final/report.json`),overview={views:after.views.filter(v=>v.id==='09-warren-towers')};
const record={
 assetId:'bu-realism-corrections-20261026',date:'2026-10-26',status:'阶段可试玩；尚未通过完整实景真实感验收',
 scope:['Warren 上部三塔形体与四向窗带','Mugar 西块南侧上部立面','GSU 面向 Link 的中层砖墙与底层窗墙','West Dining/Claflin/Sleeper 重复外壳装配','Claflin/Sleeper 楼板及三栋楼实际手机导出','精修建筑等待天空加载后捕获环境反射'],
 workTypes:['局部形体重建','窗洞与构件补全','重复装配修复','运行时反射加载修复'],
 sourceRecords:['warren-tower-reconstruction-20261026.json','sert-photo-facades-20261026.json','west-dining-separation-20261026.json','west-residence-floor-slabs-20261026.json'],
 editableMaster:'有参数、参考来源和测试的现有程序化源；本轮没有创建 Blender 母版，也不宣称整座建筑完成重建。',
 sources,
 referencePdf:{url:'https://www.bu.edu/community/files/2024/02/Warren-Towers-EPNF.pdf',sha256:await sha('output/bu-comm-ave-20261024/references/warren-epnf-2024.pdf'),preservedPages:[22,23,40],rights:'BU/MDS 公开建筑研究资料，仅保留本地对照；未用于游戏纹理，不声明开放再分发授权。',dateLimit:'采用2022–2023现状；提案中的新金属饰面未作为现状建模。'},
 comparison:{
   sameCameraPairs:pairIds,lighting:'BOSTON_DAYLIGHT; fixed against original before/report.json',
   sourcePhotos:'实景与模型为近似朝向，非相同相机/季节；真实照片没有经过编辑。',
   supplemental:['overview/09-warren-towers.png','after/10-claflin-window.png','after/11-west-residence-link.png','after/12-gsu-link-side.png'],
   excluded:[{id:'output/bu-reality-20261026/before/04-gsu-front',reason:'历史机位位于GSU壳内，不能作外立面验收。'},{id:'output/bu-reality-20261026/after/09-warren-towers',reason:'初次补充机位被CAS内部遮挡；final/09改用已验证街道位置。归档after图均来自final复验。'}],
   distinction:'before/after/overview 是真实运行时资产加载器的固定机位检查；continuous/mobile 是完整游戏HUD、人物与交互检查。',
 },
 technical:{focusedTests:{files:14,passed:83,command:'npx vitest run <14 related BU suites>',exitCode:0},mobileExportTests:{files:3,passed:13,suites:['bu-west-mobile-export','bu-cds-mobile','bu-questrom-mobile'],exitCode:0},floorSlabTests:'See west-residence-floor-slabs-20261026.json for final targeted checks after adding floor occlusion.',productionBuild:{command:'npm.cmd run build',exitCode:0,warning:'Existing large output chunks remain.'},continuous:{status:continuous.status,route:['GSU','Mugar','Marsh','Warren','CDS','Questrom'],method:'仅起点地图传送一次，后续鼠标旋转与W/Shift连续行走；没有在各段之间传送。'},mobile:{status:mobile.status,checks:mobile.checks,device:'Chrome mobile emulation 390x844 DPR3; not physical phone'},reflection:{status:reflection.status,report:`${archive}/reflections/report.json`}},
 resources:{mobileExport:exportMetrics,priorMobileExport:{bytes:24733396,triangles:670231},increase:{bytes:exportMetrics.bytes-24733396,triangles:exportMetrics.triangles-670231},fullRuntimeViews:after.views.filter(v=>v.id!=='09-warren-towers').map(v=>({id:v.id,triangles:v.triangles,drawCalls:v.calls})),overview:overview.views.map(v=>({id:v.id,triangles:v.triangles,drawCalls:v.calls})),mobileDifference:'Warren和Mugar本轮开口保留；Warren细小内窗框低档简化为平面。Claflin/Sleeper/West Dining改为专属低档源，保留楼板和材质分区；低档仍关闭动态阴影，部分次要窗扇/饰边简化。',timing:'本轮未采集足以证明60/30 FPS达标的真机帧时间序列；不作性能达标承诺。'},
 gates:{
   G0:{status:'bounded evidence recorded',note:'官方规划现状照片/图纸、BU照片和城市原始轮廓已保留；精确窗框和未覆盖朝向仍有未知。'},
   G1:{status:'partial',note:'修正Warren长宽/排列/窗带和西校区重复壳；其余立面及基座仍需重校，完整中性材质多角度验收未完成。'},
   G2:{status:'partial',note:'真实开口和框体进深通过射线及游戏画面检查；两座西区塔楼补楼板以阻止贯穿漏光。混凝土骨料、玻璃层次、局部饰面仍有差距。'},
   G3:{status:'bounded runtime checks passed',note:'本轮接入完整游戏，中央校区连续步行和移动模拟目的地/交互/画质切换通过。截图不代表整座校园实景验收。'},
   G4:{status:'partial',note:'可复现源、GLB及hash、分级差异和截图归档齐备；真机性能与完整视觉质量待继续。'},
 },
 remaining:['Warren基座层高/退界、材质尺度、设备与局部窗框仍需实景精修。','Mugar其他立面、GSU顶部和其他朝向仍有通用窗格。','West宿舍和餐厅仍是旧近似立面，本轮仅修重复装配。','草地/步道、植被位置及高楼近景阴影仍需进一步实景对照。','移动真机待验证；本地改动未发布线上。'],
 evidenceFiles:files,
};
await writeFile('assets-source/charles-bu/realism-corrections-20261026.json',JSON.stringify(record,null,2)+'\n');
const warren=await json('assets-source/charles-bu/warren-tower-reconstruction-20261026.json');
warren.validation.visual='已检查固定机位前后对照、三塔街景及完整游戏步行近景；形体类别修正成立，材质/基座和全部方向仍未完成真实感验收。详见 realism-corrections-20261026.json。';
warren.source.preservedEvidence=[...Object.keys(files).filter(p=>p.startsWith(references))];
await writeFile('assets-source/charles-bu/warren-tower-reconstruction-20261026.json',JSON.stringify(warren,null,2)+'\n');
const sert=await json('assets-source/charles-bu/sert-photo-facades-20261026.json');
sert.validation.visualStatus='已进行Mugar南侧固定机位前后和GSU庭院侧检查，并在完整游戏到访；修正后的墙/开口类别成立，整体材质和未覆盖立面仍为阶段状态。';
sert.validation.archive='docs/screenshots/bu-reality-20261026';
sert.qualityLevels.export={path:'public/data/mobile/boston.glb',sha256:sources['public/data/mobile/boston.glb'],metrics:exportMetrics};
await writeFile('assets-source/charles-bu/sert-photo-facades-20261026.json',JSON.stringify(sert,null,2)+'\n');
const west=await json('assets-source/charles-bu/west-dining-separation-20261026.json');
west.visualStatus='已在实际运行时的Claflin窗带近景和两宿舍/餐厅关系图中确认重复外墙消失；移动端已重烘焙并完成目的地加载检查。旧立面真实感仍未验收。';
west.runtimeArchive='docs/screenshots/bu-reality-20261026';
await writeFile('assets-source/charles-bu/west-dining-separation-20261026.json',JSON.stringify(west,null,2)+'\n');
const figure=(src,label)=>`<figure><img loading="lazy" src="${src}" alt="${label}"><figcaption>${label}</figcaption></figure>`;
const pair=(id,title)=>`<section><h2>${title}</h2><div class="pair">${figure(`before/${id}.png`,'修改前')}${figure(`after/${id}.png`,'本轮版本')}</div></section>`;
const referenceRoot='../../../assets-source/charles-bu/references';
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BU 本轮模型校正 · 2026-10-26</title><style>body{margin:0;background:#ecebe5;color:#243b33;font:16px/1.65 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:32px}h1{font-size:28px}h2{font-size:21px}p{max-width:1000px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}img{display:block;width:100%;height:auto;background:#ddd}figcaption{padding:8px 0;color:#53635a}section{margin:36px 0}.status{background:#fff9e5;padding:16px 22px;border-left:4px solid #b89143}a{color:#285b50}@media(max-width:800px){.pair{grid-template-columns:1fr}main{padding:18px}}</style><main><h1>BU 校园 · 本轮模型校正</h1><p class="status">阶段可试玩。形体、窗洞和重复装配已有具体修正；完整实景真实感尚未验收通过。保持原有自然暖色风格。本页为本地检查记录。</p><p>修改前 / 本轮版本使用同机位与同光照。固定机位由真实运行时资产加载器生成；下面的游戏截图保留人物与 HUD。实景照片与模型仅近似朝向，季节、相机不同。</p>
${pair('05-warren-front','Warren：三塔比例、排列与竖向窗带')}
<div class="pair">${figure(`${referenceRoot}/warren-20261026/warren-existing-photos-p23.png`,'实景参考：BU / MDS，2023现状照片')}${figure('overview/09-warren-towers.png','本轮三塔补充街景；街道机位，非照片配准')}</div>
${pair('03-mugar-south','Mugar：南侧上部实墙与深窄窗洞')}
<div class="pair">${figure(`${referenceRoot}/sert-20261025/mugar-south-2021.jpg`,'实景参考：Pi.1415926535，2021，CC BY-SA 4.0；树木遮挡部分立面')}${figure('after/03-mugar-south.png','本轮范围仅南侧上部，其他立面仍待重建')}</div>
<section><h2>GSU：Link 侧砖墙与底层窗墙</h2><div class="pair">${figure(`${referenceRoot}/sert-20261025/bu-gsu-exterior-2023.jpg`,'实景参考：BU，2023；未显示顶部完整立面')}${figure('after/12-gsu-link-side.png','本轮近景：中层砖墙、下层玻璃及框体')}</div></section>
<section><h2>西校区：拆分重复的餐厅外壳</h2><div class="pair">${figure('after/10-claflin-window.png','Claflin：原先被餐厅外墙覆盖的窗带')}${figure('after/11-west-residence-link.png','宿舍与低层餐厅：旧通用立面及景观仍待继续精修')}</div></section>
<section><h2>西区楼板与阴影</h2><div class="pair">${figure('shadow-before/11-west-residence-link.png','楼板补齐前：阳光贯穿两面窗洞，草地出现整片窗格影；此图已经拆分餐厅')}${figure('after/11-west-residence-link.png','本轮版本：补楼层遮挡，同机位与同光照')}</div></section>
<section><h2>完整游戏中的连续步行</h2><p>GSU → Mugar → Marsh → Warren → CDS → Questrom。仅起点传送，后续实际步行。手机模拟另检目的地、CDS进出、移动与画质切换；真机待验证。</p><div class="pair">${figure('continuous/01-bu-mugar.png','完整游戏：Mugar到访')}${figure('continuous/03-bu-warren.png','完整游戏：Warren步行近景')}</div></section>
<p>主要剩余差距：混凝土骨料与玻璃层次、未覆盖立面的专属几何、基座/场地精校和真机性能。技术测试通过不代表真实感达标。</p><p><a href="../../../assets-source/charles-bu/realism-corrections-20261026.json">查看来源、构建 hash、分级资源与 G0–G4 记录</a> · <a href="https://commons.wikimedia.org/wiki/File:Mugar_Memorial_Library_from_Commonwealth_Avenue,_July_2021.jpg">Mugar 图片来源与署名</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a></p></main></html>`;
await writeFile(`${archive}/review.html`,html);
console.log(JSON.stringify({archive,files:Object.keys(files).length,record:'assets-source/charles-bu/realism-corrections-20261026.json'}));
