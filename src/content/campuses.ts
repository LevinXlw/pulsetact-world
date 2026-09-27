import type {Campus, CampusId} from '../types';
export const sources = {
 'harvard-yard':{title:'Harvard · Campus Tours',url:'https://www.harvard.edu/visit/tours/',checkedAt:'2026-09-11'},
 'harvard-widener':{title:'Harvard Library · Widener Library',url:'https://library.harvard.edu/libraries/widener',checkedAt:'2026-09-11'},
 'harvard-memorial':{title:'Harvard · The Memorial Church',url:'https://memorialchurch.harvard.edu/',checkedAt:'2026-09-11'},
 'mit':{title:'MIT · Visit',url:'https://www.mit.edu/visitmit/',checkedAt:'2026-09-11'}
};
export const campuses:Record<CampusId,Campus> = {
 mit:{id:'mit',name:'麻省理工学院',en:'Massachusetts Institute of Technology',area:'Killian Court',description:'在穹顶下，让一个想法慢慢成形。',accent:'#367c74',spawn:[0,11],blockers:[{x:0,z:-8,w:19,d:5},{x:-12,z:-2,w:4,d:16},{x:12,z:-2,w:4,d:16}],targets:[
 {id:'mit-killian',kind:'poi',name:'基利安庭院',en:'Killian Court',position:[0,8],summary:'MIT 官方访校资料介绍了 Killian Court 与 Great Dome：从庭院可以仰望穹顶。先沿步道走走，找一个你喜欢的观察角度。',sourceId:'mit',prompt:'开阔的公共空间会怎样影响你的学习日常？'},
 {id:'mit-dome',kind:'poi',name:'大穹顶',en:'Great Dome',position:[0,-3],summary:'Great Dome 是 MIT 校园的醒目地标，从 Killian Court 可以看见。这里的建筑由程序化体块重现轮廓，比例经过艺术化压缩。',sourceId:'mit',prompt:'你在这座建筑上注意到了哪些重复的形状？'},
 {id:'mit-corridor',kind:'poi',name:'无尽长廊',en:'Infinite Corridor',position:[8,-2],summary:'MIT 官方资料介绍，许多院系、教室和实验室从 Infinite Corridor 延伸开来。这里的入口通往一段模拟走廊与项目空间。',sourceId:'mit',prompt:'一条连接不同学科的走廊，可能带来什么相遇？'},
 {id:'mit-alex',kind:'npc',name:'Alex',en:'Ideas into things',position:[-5,4],summary:'喜欢做模型，也喜欢听队友讲完全不同的想法。'},
 {id:'mit-sam',kind:'npc',name:'Sam',en:'Art meets technology',position:[5,4],summary:'在代码、音乐与安静散步之间寻找自己的节奏。'},
 {id:'mit-study-space',kind:'activity',name:'设计校园学习空间',en:'The little design studio',position:[8,1],summary:'带着 10 点预算，把你的学习空间构想变成小模型。'}]},
 harvard:{id:'harvard',name:'哈佛大学',en:'Harvard University',area:'Harvard Yard',description:'穿过红砖与树影，遇见新的问题。',accent:'#a65145',spawn:[0,11],blockers:[{x:0,z:-8,w:16,d:5},{x:-12,z:-1,w:5,d:13},{x:12,z:-5,w:5,d:8}],targets:[
 {id:'harvard-yard',kind:'poi',name:'哈佛庭院',en:'Harvard Yard',position:[0,8],summary:'Harvard 官方校园导览包含 Harvard Yard。在这个艺术化庭院里，沿着步道探索地点，与虚构学生交流，收集你自己的问题。',sourceId:'harvard-yard',prompt:'怎样的校园环境会让你想停下来读一会儿书？'},
 {id:'harvard-widener',kind:'poi',name:'怀德纳图书馆',en:'Widener Library',position:[0,-3],summary:'Widener Library 位于 Harvard Yard 的中心地带，提供丰富的研究馆藏。图书馆由 Eleanor Elkins Widener 捐资建造，以纪念她的儿子 Harry。',sourceId:'harvard-widener',prompt:'如果有一个下午自由阅读，你会从什么主题开始？'},
 {id:'harvard-memorial',kind:'poi',name:'纪念教堂',en:'Memorial Church',position:[8,-2],summary:'Memorial Church 是 Harvard 的校园教堂。停下来观察塔楼、庭院与周围建筑的关系；更多信息可在教堂官方页面了解。',sourceId:'harvard-memorial',prompt:'你希望校园里有哪些可以安静思考的地方？'},
 {id:'harvard-maya',kind:'npc',name:'Maya',en:'Stay curious',position:[-5,4],summary:'喜欢讨论，也愿意在新的信息面前改变想法。'},
 {id:'harvard-leo',kind:'npc',name:'Leo',en:'Find your own rhythm',position:[5,4],summary:'从小项目开始，寻找自己愿意持续投入的事情。'},
 {id:'harvard-course-discussion',kind:'activity',name:'AI 应该怎样帮助选课？',en:'A seat at the table',position:[-8,1],summary:'坐进讨论室，比较兴趣、基础与时间，留下自己的判断。'}]}
};
export const campusIds:CampusId[]=['harvard','mit'];
