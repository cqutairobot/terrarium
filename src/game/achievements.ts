import type { World } from '../sim/world';
import { ALL_RARE_KEYS, ALL_WATERS } from './collection';
import { has } from './economy';
import { CHAPTERS } from './levels';
import { mainTankCount, type Profile } from './profile';

/** What an achievement can look at: the profile, and the garden tank on show (none during a challenge). */
export interface AchievementFacts {
  profile: Profile;
  world: World | null;
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Lumen given when it is earned. */
  reward: number;
  done(f: AchievementFacts): boolean;
}

const stat = (p: Profile, k: string) => p.stats[k] ?? 0;
const rareSeen = (p: Profile) => ALL_RARE_KEYS.filter((k) => p.collection.rare[k]).length;
/** Rare traits counted by locus (any special eye, either tentacle variant). */
const lociSeen = (p: Profile) => new Set(Object.keys(p.collection.rare).map((k) => (k.startsWith('eyes') ? 'eyes' : k.startsWith('multiTentacle') ? 'tentacle' : k))).size;
const chapterStars = (p: Profile, id: number) => CHAPTERS.find((c) => c.id === id)!.levels.reduce((a, l) => a + (p.levels[l.id]?.stars ?? 0), 0);
const chapterDone = (p: Profile, id: number) => CHAPTERS.find((c) => c.id === id)!.levels.every((l) => (p.levels[l.id]?.stars ?? 0) > 0);

/** 成就: milestones of real play, each noticed once and rewarded a little. */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-feed', name: '第一口食物', desc: '第一次给水缸撒下食物。', reward: 10, done: (f) => stat(f.profile, 'feeds') >= 1 },
  { id: 'watcher', name: '守望者', desc: '关注一只生命，记下它的一生。', reward: 10, done: (f) => stat(f.profile, 'watched') >= 1 },
  { id: 'matchmaker', name: '牵线人', desc: '第一次为两只生命配对。', reward: 15, done: (f) => stat(f.profile, 'pairs') >= 1 },
  { id: 'first-request', name: '有求必应', desc: '完成第一个委托。', reward: 15, done: (f) => f.profile.requests.completed >= 1 },
  { id: 'ten-requests', name: '远近闻名', desc: '完成 10 个委托。', reward: 40, done: (f) => f.profile.requests.completed >= 10 },
  { id: 'golden', name: '点石成金', desc: '见到一只金色身体的生命。', reward: 20, done: (f) => !!f.profile.collection.rare.golden },
  { id: 'three-wonders', name: '奇迹收藏家', desc: '见到 3 种稀有特征。', reward: 30, done: (f) => rareSeen(f.profile) >= 3 },
  { id: 'all-wonders', name: '万象', desc: '7 种稀有基因带来的样子都见过（眼睛和触须见过一种就算）。', reward: 100, done: (f) => lociSeen(f.profile) >= 7 },
  { id: 'gen-20', name: '生生不息', desc: '一个水缸繁衍到第 20 代。', reward: 25, done: (f) => (f.world?.counters.generationsMax ?? 0) >= 20 },
  { id: 'gen-50', name: '代代相传', desc: '一个水缸繁衍到第 50 代。', reward: 50, done: (f) => (f.world?.counters.generationsMax ?? 0) >= 50 },
  { id: 'speciation', name: '一分为二', desc: '亲眼见到一个新族群从旧族群里分出来。', reward: 25, done: (f) => stat(f.profile, 'speciation') >= 1 },
  { id: 'spread', name: '薪火相传', desc: '一种稀有特征在族群里传开。', reward: 20, done: (f) => stat(f.profile, 'spread') >= 1 },
  { id: 'crowd', name: '人丁兴旺', desc: '一个水缸里同时有 150 只小生命。', reward: 20, done: (f) => (f.world?.consumerCount ?? 0) >= 150 },
  { id: 'three-tanks', name: '水族馆', desc: '同时养 3 个水缸。', reward: 20, done: (f) => mainTankCount(f.profile) >= 3 },
  { id: 'lens', name: '洞察', desc: '得到基因透镜。', reward: 10, done: (f) => has(f.profile, 'lens') },
  { id: 'nursery', name: '精心培育', desc: '拥有一个育种缸。', reward: 10, done: (f) => f.profile.tanks.some((t) => t.kind === 'nursery') },
  { id: 'revive', name: '重生', desc: '用生命卡让一只生命重新出生。', reward: 15, done: (f) => stat(f.profile, 'revived') >= 1 },
  { id: 'release', name: '放归', desc: '第一次放生一只生命。', reward: 10, done: (f) => stat(f.profile, 'released') >= 1 },
  { id: 'all-forms', name: '千姿百态', desc: '养过水母、小虾和螺。', reward: 30, done: (f) => !!(f.profile.collection.forms.jelly && f.profile.collection.forms.shrimp && f.profile.collection.forms.snail) },
  { id: 'decorator', name: '布景师', desc: '在水缸里放下 3 件装饰。', reward: 15, done: (f) => stat(f.profile, 'decor') >= 3 },
  { id: 'all-waters', name: '三种水', desc: '养过浅滩、寒冷深渊和暖光珊瑚礁的水缸。', reward: 40, done: (f) => ALL_WATERS.every((w) => f.profile.collection.waters[w]) },
  { id: 'chapter-1', name: '浅滩毕业', desc: '完成第一章的全部挑战。', reward: 50, done: (f) => chapterDone(f.profile, 1) },
  { id: 'chapter-1-stars', name: '满天星', desc: '在第一章拿到全部 24 颗星。', reward: 80, done: (f) => chapterStars(f.profile, 1) >= 24 },
  { id: 'daily', name: '每日一题', desc: '完成一次每日挑战。', reward: 15, done: (f) => Object.keys(f.profile.levels).some((k) => k.startsWith('daily-') && f.profile.levels[k].stars > 0) },
];

/** Achievements newly earned by these facts (not yet in the profile). */
export function newlyEarned(f: AchievementFacts): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => !f.profile.achievements[a.id] && a.done(f));
}
