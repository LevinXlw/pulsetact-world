export type CharacterId = 'pixiv' | 'sakurada' | 'hiyori';
export type PlayableCharacterId = 'pixiv' | 'sakurada';
export function isPlayableCharacter(value: unknown): value is PlayableCharacterId {
  return value === 'pixiv' || value === 'sakurada';
}
export function normalizePlayableCharacter(value: unknown): PlayableCharacterId {
  return isPlayableCharacter(value) ? value : 'pixiv';
}
export const CHARACTER_OPTIONS = [
  {id: 'pixiv', label: '白 T', detail: '休闲漫游者', marker: '01'},
  {id: 'sakurada', label: 'Sakurada', detail: '学院风少年', marker: '02'},
] as const;
export type CharacterMotion = 'Idle' | 'Walk' | 'Run';
export type CharacterCandidate = {
  id: CharacterId;
  name: string;
  subtitle: string;
  description: string;
  license: string;
  source: string;
  url?: string;
  facing: number;
  motions: CharacterMotion[];
};

export const CHARACTER_CANDIDATES: CharacterCandidate[] = [
  {
    id: 'pixiv', name: '白 T · 休闲漫游者', subtitle: 'PIXIV · CASUAL',
    description: '白 T、黑色短裤和运动鞋。保留原作的脸部与服装，用校园的日光观察人物比例。',
    license: 'VRM Public License 1.0 · 允许商用、修改和再分发',
    source: 'https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample',
    url: '/assets/characters/pixiv/character.glb', facing: Math.PI,
    motions: ['Idle', 'Walk', 'Run'],
  },
  {
    id: 'sakurada', name: 'Sakurada · 城市少年', subtitle: 'VROID · SAKURADA FUMIRIYA',
    description: '浅金发、白衬衫、深蓝针织背心与橙红领带。偏学院风的男角色，在同一光照下比较比例与动作。',
    license: '官方 FAQ 标注 CC0 · 模型保留原始 Hub 授权信息',
    source: 'https://hub.vroid.com/en/characters/6912965120285194650/models/2261505926203110716',
    url: '/assets/characters/sakurada/sakurada.glb', facing: Math.PI, motions: ['Idle', 'Walk', 'Run'],
  },
  {
    id: 'hiyori', name: 'Hiyori · 户外探索者', subtitle: 'HENGE · MIZUNASHI HIYORI',
    description: '现代户外装候选。官方免费包需要登录 BOOTH 下载，模型尚未导入。',
    license: 'CC0 · 仅 FBX 与贴图目录',
    source: 'https://booth.pm/ja/items/6120660',
    facing: 0, motions: [],
  },
];

export function characterCandidate(id: CharacterId) {
  return CHARACTER_CANDIDATES.find(candidate => candidate.id === id)!;
}
