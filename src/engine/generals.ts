import { GeneralDefinition, PlayerRole, RngFn, SkillName } from "./types.js";

const humanGeneral: GeneralDefinition = {
  kingdom: "吴",
  name: "孙策",
  gender: "男",
  maxHp: 4,
  skills: [SkillName.JiAng, SkillName.HunZi, SkillName.ZhiBa],
};

const commonGeneralPool: GeneralDefinition[] = [
  { kingdom: "魏", name: "夏侯惇", gender: "男", maxHp: 4, skills: [SkillName.GangLie] },
  { kingdom: "魏", name: "许褚", gender: "男", maxHp: 4, skills: [SkillName.LuoYi] },
  { kingdom: "蜀", name: "关羽", gender: "男", maxHp: 4, skills: [SkillName.WuSheng] },
  { kingdom: "蜀", name: "张飞", gender: "男", maxHp: 4, skills: [SkillName.Roar] },
  { kingdom: "蜀", name: "赵云", gender: "男", maxHp: 4, skills: [SkillName.LongDan] },
  { kingdom: "蜀", name: "马超", gender: "男", maxHp: 4, skills: [SkillName.MaShu, SkillName.TieQi] },
  { kingdom: "蜀", name: "黄月英", gender: "女", maxHp: 3, skills: [SkillName.JiZhi, SkillName.QiCai] },
  { kingdom: "吴", name: "黄盖", gender: "男", maxHp: 4, skills: [SkillName.KuRou] },
  { kingdom: "群雄", name: "吕布", gender: "男", maxHp: 4, skills: [SkillName.WuShuang] },
  { kingdom: "魏", name: "曹仁", gender: "男", maxHp: 4, skills: [SkillName.JuShou, SkillName.JieWei] },
  { kingdom: "魏", name: "甄姬", gender: "女", maxHp: 3, skills: [SkillName.QingGuo, SkillName.LuoShen] },
  { kingdom: "吴", name: "孙权", gender: "男", maxHp: 4, skills: [SkillName.ZhiHeng, SkillName.JiuYuan] },
  { kingdom: "吴", name: "周瑜", gender: "男", maxHp: 3, skills: [SkillName.Heroic, SkillName.FanJian] },
  { kingdom: "吴", name: "孙尚香", gender: "女", maxHp: 3, skills: [SkillName.JieYin, SkillName.XiaoJi] },
  { kingdom: "群雄", name: "貂蝉", gender: "女", maxHp: 3, skills: [SkillName.LiJian, SkillName.BiYue] },
  { kingdom: "群雄", name: "华佗", gender: "男", maxHp: 3, skills: [SkillName.QingNang, SkillName.JiJiu] },
];

// Kept only for loading explicit legacy configurations; these generals are not selectable or randomly assigned.
const disabledGeneralDefinitions: GeneralDefinition[] = [
  { kingdom: "魏", name: "曹操", gender: "男", maxHp: 4, skills: [SkillName.JianXiong, SkillName.HuJia] },
  { kingdom: "魏", name: "张辽", gender: "男", maxHp: 4, skills: [SkillName.TuXi] },
  { kingdom: "魏", name: "郭嘉", gender: "男", maxHp: 3, skills: [SkillName.TianDu, SkillName.YiJi] },
  { kingdom: "魏", name: "司马懿", gender: "男", maxHp: 3, skills: [SkillName.FanKui, SkillName.GuiCai] },
  { kingdom: "蜀", name: "刘备", gender: "男", maxHp: 4, skills: [SkillName.RenDe, SkillName.JiJiang] },
  { kingdom: "蜀", name: "诸葛亮（标准版）", gender: "男", maxHp: 3, skills: [SkillName.GuanXing, SkillName.KongCheng] },
  { kingdom: "吴", name: "陆逊", gender: "男", maxHp: 3, skills: [SkillName.QianXun, SkillName.LianYing] },
  { kingdom: "吴", name: "大乔", gender: "女", maxHp: 3, skills: [SkillName.GuoSe, SkillName.LiuLi] },
];

export const GENERAL_LIBRARY: GeneralDefinition[] = [humanGeneral, ...commonGeneralPool];

export function buildRoleList(playerCount: number): PlayerRole[] {
  if (playerCount === 2) {
    return [PlayerRole.Lord, PlayerRole.Rebel];
  }
  if (playerCount === 3) {
    return [PlayerRole.Lord, PlayerRole.Rebel, PlayerRole.Traitor];
  }
  if (playerCount === 4) {
    return [PlayerRole.Lord, PlayerRole.Loyalist, PlayerRole.Rebel, PlayerRole.Traitor];
  }
  if (playerCount === 5) {
    return [PlayerRole.Lord, PlayerRole.Loyalist, PlayerRole.Rebel, PlayerRole.Rebel, PlayerRole.Traitor];
  }
  if (playerCount === 6) {
    return [
      PlayerRole.Lord,
      PlayerRole.Loyalist,
      PlayerRole.Rebel,
      PlayerRole.Rebel,
      PlayerRole.Rebel,
      PlayerRole.Traitor,
    ];
  }
  return [PlayerRole.Lord, PlayerRole.Loyalist, PlayerRole.Rebel, PlayerRole.Rebel, PlayerRole.Traitor];
}

export function getRoleDistribution(roles: PlayerRole[]): { rebel: number; loyalist: number; traitor: number } {
  let rebel = 0;
  let loyalist = 0;
  let traitor = 0;
  for (const role of roles) {
    if (role === PlayerRole.Rebel) {
      rebel += 1;
    } else if (role === PlayerRole.Loyalist) {
      loyalist += 1;
    } else if (role === PlayerRole.Traitor) {
      traitor += 1;
    }
  }
  return { rebel, loyalist, traitor };
}

export function resolveGeneralByName(generalName: string): GeneralDefinition {
  const found = [...GENERAL_LIBRARY, ...disabledGeneralDefinitions].find((item) => item.name === generalName);
  if (found) {
    return found;
  }
  return humanGeneral;
}

export function getAiName(index: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const first = alphabet[index % alphabet.length] ?? "A";
  const cycle = Math.floor(index / alphabet.length);
  if (cycle === 0) {
    return first;
  }
  return `${first}${cycle + 1}`;
}

export function pickRandomUnusedGeneral(usedGeneralNames: Set<string>, rng: RngFn): GeneralDefinition {
  const candidates = GENERAL_LIBRARY.filter((general) => !usedGeneralNames.has(general.name));
  if (candidates.length <= 0) {
    const fallback = GENERAL_LIBRARY[Math.floor(rng() * GENERAL_LIBRARY.length)];
    return fallback ?? humanGeneral;
  }
  const picked = candidates[Math.floor(rng() * candidates.length)];
  return picked ?? humanGeneral;
}
