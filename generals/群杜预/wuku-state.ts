// 群杜预共享状态：武库标记（上限 3）与三陈觉醒标志。
//
// 武库/三陈/灭吴三个技能共用同一份状态（WeakMap<Player, …>，玩家对象回收即丢弃，
// 与界王平/兵略的跨回合状态同一写法）。本文件不是技能文件，loader 与校验器不枚举它，
// 只被同目录的三个 .skill.ts 以 `./wuku-state.js` 引用（NodeNext 风格 .js 后缀）。
import type { Player } from "../../../types/generals-pack.js";

/** 引擎牌库里的全部 24 种装备牌类（武器 12 / 防具 4 / 马 7 / 宝物 1，以 CardType 中文值为准）。 */
export const EQUIPMENT_TYPES: ReadonlySet<string> = new Set([
  "诸葛连弩",
  "雌雄双股剑",
  "青釭剑",
  "寒冰剑",
  "银月枪",
  "古锭刀",
  "丈八蛇矛",
  "青龙偃月刀",
  "贯石斧",
  "方天画戟",
  "麒麟弓",
  "朱雀羽扇",
  "八卦阵",
  "仁王盾",
  "藤甲",
  "白银狮子",
  "的卢",
  "绝影",
  "爪黄飞电",
  "骅骝",
  "赤兔",
  "大宛",
  "紫骍",
  "木牛流马",
]);

const MAX_MARKS = 3;
const marks = new WeakMap<Player, number>();
const awakened = new WeakMap<Player, boolean>();

export const getMarks = (player: Player): number => marks.get(player) ?? 0;

export const addMark = (player: Player): number => {
  const next = Math.min(MAX_MARKS, getMarks(player) + 1);
  marks.set(player, next);
  return next;
};

export const consumeMark = (player: Player): boolean => {
  const current = getMarks(player);
  if (current <= 0) {
    return false;
  }
  marks.set(player, current - 1);
  return true;
};

export const isAwakened = (player: Player): boolean => awakened.get(player) ?? false;

export const setAwakened = (player: Player): void => {
  awakened.set(player, true);
};
