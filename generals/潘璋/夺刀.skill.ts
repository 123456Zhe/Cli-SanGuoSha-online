import type {
Card,
Player,
SkillEventPayload,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 夺刀（潘璋）— 触发技，after_damage。
//
// 规则（Fandom 潘璋&马忠页，新一将成名2013）：当你受到造成的伤害后，
// 你可以弃置一张牌，然后获得伤害来源装备区里的武器牌。
// （一将成名2013 旧版为“每当你受到造成的一次伤害后”，新版去掉“每当”，含义相同。）
//
// 实现要点：
// - 触发条件：payload.target 为持有者且存活；payload.card 为杀/火杀/雷杀
// （after_damage 的 payload.card 即造成伤害的那张牌，见 applyDamage）；
// payload.source 存在且存活且装有武器——无武器时不发动，免得白弃一张牌。
// 伤害来源已死亡时无法获得武器（FAQ），此时也不发动。
// - 代价：弃置一张手牌（origin=hand）。FAQ 允许弃置装备区牌，
// 但 buildUsableSources 只含手牌+木牛内牌，装备区不在候选里，暂不支持。
// - 获得武器：装备区只存类型不存牌实体（Player.weapon 为 WeaponType），
// 按引擎 createCard 的惯例重建一张牌（colorless / suit none / rank 0），
// id 用 WeakMap 计数保证唯一（不用 Math.random）；来源武器槽直接置 null。
// - 限制：来源武器槽是直接赋值，equip_lost 钩子不触发（枭姬不联动）；
// 弃置仅限手牌。

const SKILL_ID = "潘璋/夺刀";
const SLASH_TYPES = new Set(["杀", "火杀", "雷杀"]);
const lootCounts = new WeakMap<Player, number>();

export default {
id: "夺刀",
displayName: "夺刀",
kind: "triggered",
triggers: ["after_damage"],
description:
"当你受到造成的伤害后，你可以弃置一张牌，然后获得伤害来源装备区里的武器牌。",
onTrigger: {
after_damage: async (
ctx: SkillModuleCtx,
payload: SkillEventPayload,
logs: string[],
) => {
const target = payload.target;
const source = payload.source;
if (!target ||!target.alive) return;
if (!ctx.hasSkill(target, SKILL_ID)) return;
const card = payload.card;
if (!card ||!SLASH_TYPES.has(card.type)) return;
if (!source ||!source.alive) return;
const weaponType = source.weapon;
if (!weaponType) return;
if (target.hand.length < 1) return;
if (!(await ctx.shouldActivateOptionalEffect(target, SKILL_ID))) return;
const sources = ctx
.buildUsableSources(target)
.filter((s) => s.origin === "hand");
const [discarded] = await ctx.requestDiscardSelection(
target,
1,
"夺刀：弃置一张牌",
sources,
);
if (!discarded) {
logs.push(`${target.name} 发动【夺刀】失败：未弃置牌`);
return;
}
await ctx.discardCards([discarded], target, "弃置", logs);
source.weapon = null;
const count = (lootCounts.get(target)?? 0) + 1;
lootCounts.set(target, count);
const loot: Card = {
id: `夺刀-${weaponType}-${count}`,
type: weaponType,
color: "colorless",
suit: "none",
rank: 0,
};
target.hand.push(loot);
logs.push(
`${target.name} 发动【夺刀】，弃置 ${discarded.type}，获得 ${source.name} 的 ${weaponType}`,
);
},
},
} satisfies SkillModule;
