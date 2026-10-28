import type { World } from '../sim/world';

/** What the tutorial watches to know a step is done. */
export interface TutorialFacts {
  world: World;
  feeds: number;
  selectedId: number;
  panel: string | null;
}

export interface TutorialStep {
  text: string;
  /** Done when this holds (steps without a check wait for the "next" button). */
  done?(f: TutorialFacts): boolean;
}

/** A gentle first visit: feed, look, watch, read the requests, match a pair, and what comes next. */
export const TUTORIAL: readonly TutorialStep[] = [
  { text: '这是你的水缸。里面的小生命会自己觅食、长大、相爱、老去，把基因传给孩子。你不能指挥它们，但可以照顾它们。' },
  { text: '点一下水中的空白处，撒一点食物。长按可以一直撒。', done: (f) => f.feeds > 0 },
  { text: '点一只小生命，看看它的观察卡：它的名字、年龄、性格和基因都在这里。', done: (f) => f.selectedId !== 0 },
  { text: '按观察卡上的 ☆ 关注它，它的一生就会被记下来。也可以按 ✎ 给它取个名字。', done: (f) => [...f.world.history.stories.values()].some((s) => s.watched) },
  { text: '鼠标移到屏幕底部，打开「委托」：住在水缸附近的人们，想要各种各样的生命。', done: (f) => f.panel === 'requests' },
  { text: '想培育出某种样子，就给两只生命配对：在观察卡上点「为它配对…」，再点另一只。配对前能看到孩子们大概会是什么样。', done: (f) => f.world.creatures.some((c) => c.bondId !== 0) },
  { text: '两只都准备好时，它们就会去找对方。孩子长大以后，把符合委托的那只交出去，就能得到灵光，在「灵光商店」里换新的生命、工具和水缸。祝你玩得愉快。' },
];
