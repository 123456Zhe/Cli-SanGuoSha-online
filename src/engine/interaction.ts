import type { Card } from "./cards.js";

export type ResponseKind = "dodge" | "slash" | "negate" | "peach";

export type CardOrigin = "hand" | "treasure";
export type CardSuit = Card["suit"];

export type CardSource = {
  sourceId: string;
  origin: CardOrigin;
  card: Card;
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
