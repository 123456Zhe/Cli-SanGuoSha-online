// 群杜预共享状态：武库标记（上限 3）与三陈觉醒标志。
//
// 武库/三陈/灭吴三个技能共用同一份状态（WeakMap<Player, …>，玩家对象回收即丢弃，
// 与界王平/兵略的跨回合状态同一写法）。本文件不是技能文件，loader 与校验器不枚举它，
// 只被同目录的三个 .skill.ts 以 `./wuku-state.js` 引用（NodeNext 风格 .js 后缀）。
//
// 装备判定不要在这里硬编码装备名：走 `ctx.isEquipCard`（引擎的装备列表，新增装备
// 自动跟进）。本文件曾硬编码 24 种装备名，引擎新增装备时武库会静默漏计（2026-11-09 巡检）。
import type { Player } from "../../../types/generals-pack.js";

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
