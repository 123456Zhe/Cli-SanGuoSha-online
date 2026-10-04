import type { Card } from "./cards.js";

export type ResponseKind = "dodge" | "slash" | "negate" | "peach";

/** 可选牌来源：手牌 / 木牛流马内存牌 / 装备区（"弃置任意张牌"类技能会给出装备区选项）。 */
export type CardOrigin = "hand" | "treasure" | "equip";
export type CardSuit = Card["suit"];

export type CardSource = {
  sourceId: string;
  origin: CardOrigin;
  /**
   * 关联的真实卡牌。指向其他玩家手牌的匿名选项（如反间）会省略该字段，
   * 避免把牌面信息发给不应看到的客户端；仅凭 sourceId 即可完成结算。
   */
  card?: Card;
  label: string;
};

export type InteractionTrigger = {
  cardName: string;
  actorId: string;
};

export type InteractionRequest =
  | {
      kind: "respond";
      requestId: number;
      responderId: string;
      trigger: InteractionTrigger;
      responseKind: ResponseKind;
      sources: CardSource[];
      allowPass: true;
      reason: string;
    }
  | {
      kind: "collateral";
      requestId: number;
      targetId: string;
      actorId: string;
      victims: string[];
      sources: CardSource[];
      allowHandOverWeapon: boolean;
      reason: string;
    }
  | {
      kind: "choose-discard";
      requestId: number;
      playerId: string;
      reason: string;
      sources: CardSource[];
      count: number;
      allowPass: boolean;
      passLabel?: string;
    }
  | {
      kind: "choose-suit";
      requestId: number;
      playerId: string;
      reason: string;
      suits: CardSuit[];
    }
  | {
      kind: "optional-effect";
      requestId: number;
      playerId: string;
      effect: string;
      reason: string;
    };

export type InteractionDecision =
  | { choice: "pass" }
  | { choice: "card"; sourceId: string }
  | { choice: "target"; targetId: string; sourceId?: string }
  | { choice: "suit"; suit: CardSuit }
  | { choice: "effect"; enabled: boolean };

export type DecisionHandler = (request: InteractionRequest) => InteractionDecision | null | Promise<InteractionDecision | null>;
