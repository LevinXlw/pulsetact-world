import {dialogues,type Topic} from '../../content/dialogues';
const introductions:Record<string,Topic>={
 'mit-alex':{title:'第一次来这里，从哪里开始？',text:'先别急着看完整个校园。去大穹顶前停一会儿，找一种你注意到的形状。Sam 就在附近，你可以和她聊聊这个发现。',choices:[{label:'我想看看建筑的细节',text:'那就留意柱子和穹顶的关系吧。带着一个小问题散步，比赶着走完所有地点更有意思。'},{label:'我更好奇这里的生活',text:'也可以观察庭院留给大家怎样的空间。去看一眼，再问问 Sam 喜欢在哪里停下来。'}]},
 'mit-sam':{title:'一起聊聊眼前的庭院',text:'同一个地方，每个人会注意到不同的东西。建筑的形状和人在这里度过的时间，你更想聊哪一个？',choices:[{label:'重复的形状让我想到节奏',text:'我也会这样联想。柱子有间隔，音乐也有停顿。今天带走这个小发现，就已经是一段很好的探索。'},{label:'我想在这里坐下来想事情',text:'那也很值得。校园不只有课表里的目的地，还需要让想法慢慢出现的地方。欢迎下次再来聊。'}]},
 'harvard-maya':{title:'带我认识一下这个庭院吧',text:'我们做个小探索吧：到怀德纳图书馆前，看一看阅读空间和庭院的关系。Leo 在附近，他很喜欢讨论一天里那些安静的片刻。',choices:[{label:'我想找适合阅读的地方',text:'可以留意开阔和安静各自带来的感觉。到了图书馆前，再想想自己会带哪一本书来。'},{label:'我对大家如何相遇更好奇',text:'那就看看步道如何连接建筑。人与人相遇的地方，有时也会成为问题和想法相遇的地方。'}]},
 'harvard-leo':{title:'如果在这里留一个下午……',text:'先把要做的事放一放。如果能在庭院附近留一个下午，你想怎样度过？',choices:[{label:'读一本一直想读的书',text:'我会选一小段认真读，再记下一个想继续追问的问题。探索不一定要去很远，也可以从一页书开始。'},{label:'和一个新朋友聊聊',text:'那我们已经开始了。把今天注意到的一件小事记进手册，下次也许就能从那里继续这段对话。'}]},
};
export function storyTopics(id:string):Topic[]{return introductions[id]?[introductions[id],...dialogues[id]]:dialogues[id]||[];}
