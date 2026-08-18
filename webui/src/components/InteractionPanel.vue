<script setup lang="ts">
import { computed } from "vue";
import { useGameConnection } from "../composables/useGameConnection.js";
import type { InteractionRequest } from "../protocol.js";

const { interactionRequest, sendDecision, playerNameOf, setAsking } = useGameConnection();

const visible = computed(() => interactionRequest.value !== null);
const request = computed(() => interactionRequest.value);

const choose = (decision: Parameters<typeof sendDecision>[0]) => {
  setAsking(false);
  sendDecision(decision);
  interactionRequest.value = null;
};

const suitLabel = (suit: string) =>
  ({ heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃" }[suit] ?? suit);
</script>

<template>
  <div v-if="visible && request" class="interaction-panel">
    <!-- respond: 打杀/闪/无懈/桃 -->
    <template v-if="request.kind === 'respond'">
      <div class="prompt">{{ request.reason }}</div>
      <button
        v-for="source in request.sources"
        :key="source.sourceId"
        class="act-btn"
        @click="choose({ choice: 'card', sourceId: source.sourceId })"
      >
        {{ source.label }}
      </button>
      <button class="act-btn" @click="choose({ choice: 'pass' })">不应对</button>
    </template>

    <!-- collateral: 借刀杀人 -->
    <template v-else-if="request.kind === 'collateral'">
      <div class="prompt">{{ request.reason }}</div>
      <template v-for="victimId in request.victims" :key="victimId">
        <button
          class="act-btn"
          @click="
            request.sources.length > 1
              ? choose({ choice: 'target', targetId: victimId })
              : choose({ choice: 'target', targetId: victimId })
          "
        >
          对 {{ playerNameOf(victimId) }} 使用杀
        </button>
      </template>
      <button
        v-if="request.allowHandOverWeapon"
        class="act-btn"
        @click="choose({ choice: 'pass' })"
      >
        交出武器
      </button>
    </template>

    <!-- choose-discard: 选弃牌 -->
    <template v-else-if="request.kind === 'choose-discard'">
      <div class="prompt">{{ request.reason }}</div>
      <button
        v-for="source in request.sources"
        :key="source.sourceId"
        class="act-btn"
        @click="choose({ choice: 'card', sourceId: source.sourceId })"
      >
        {{ source.label }}
      </button>
      <button
        v-if="request.allowPass"
        class="act-btn"
        @click="choose({ choice: 'pass' })"
      >
        {{ request.passLabel ?? "放弃" }}
      </button>
    </template>

    <!-- choose-suit: 声明花色 -->
    <template v-else-if="request.kind === 'choose-suit'">
      <div class="prompt">{{ request.reason }}</div>
      <button
        v-for="suit in request.suits"
        :key="suit"
        class="act-btn"
        @click="choose({ choice: 'suit', suit })"
      >
        声明{{ suitLabel(suit) }}
      </button>
    </template>

    <!-- optional-effect: 是否发动技能 -->
    <template v-else-if="request.kind === 'optional-effect'">
      <div class="prompt">{{ request.reason }}</div>
      <button class="act-btn primary" @click="choose({ choice: 'effect', enabled: true })">
        发动
      </button>
      <button class="act-btn" @click="choose({ choice: 'effect', enabled: false })">
        不发动
      </button>
    </template>

    <!-- 未处理类型（理论上不会到达） -->
    <template v-else>
      <div class="prompt">未处理的交互类型</div>
    </template>
  </div>
</template>
