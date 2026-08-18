<script setup lang="ts">
import { ref } from "vue";
import { useGameConnection } from "../composables/useGameConnection.js";
import type { GameAction, RemovableCardOption } from "../protocol.js";

const {
  actions,
  removableCards,
  pendingDiscardCount,
  snapshot,
  playerId,
  sendAction,
  sendDiscard,
  setAsking,
} = useGameConnection();

type Step = "idle" | "pick-target" | "pick-card";
const step = ref<Step>("idle");
const selectedAction = ref<GameAction | null>(null);
const selectedActionIndex = ref(-1);
const selectedTargetId = ref("");

const playerNameOf = (id: string) => {
  const p = snapshot.value?.players.find((pp) => pp.id === id);
  return p?.name ?? id;
};

// ── 出牌 ──

const onActionClick = (index: number) => {
  const action = actions.value[index];
  if (!action) return;
  if (action.type === "end" || !action.requiresTarget) {
    setAsking(false);
    sendAction(index);
    return;
  }
  selectedAction.value = action;
  selectedActionIndex.value = index;
  step.value = "pick-target";
  setAsking(true);
};

const onTargetClick = (targetId: string) => {
  const cardOptions = removableCards.value[targetId];
  if (cardOptions && cardOptions.length > 0) {
    selectedTargetId.value = targetId;
    step.value = "pick-card";
    return;
  }
  setAsking(false);
  sendAction(selectedActionIndex.value, targetId);
};

const onCardOptionClick = (option: RemovableCardOption) => {
  setAsking(false);
  sendAction(selectedActionIndex.value, selectedTargetId.value, option.id);
};

const cancel = () => {
  step.value = "idle";
  selectedAction.value = null;
};

// ── 弃牌 ──

const onDiscardClick = (index: number) => {
  setAsking(false);
  sendDiscard(index);
};

const me = () => snapshot.value?.players.find((p) => p.id === playerId.value);
</script>

<template>
  <div class="action-panel">
    <!-- 弃牌阶段 -->
    <template v-if="pendingDiscardCount > 0">
      <div class="prompt">弃牌阶段：还需弃置 {{ pendingDiscardCount }} 张</div>
      <template v-if="me()">
        <template v-for="(card, i) in me()!.hand ?? []" :key="'h' + i">
          <button class="act-btn" @click="onDiscardClick(i)">{{ card.type }}</button>
        </template>
        <template v-for="(card, i) in me()!.treasureCards ?? []" :key="'t' + i">
          <button class="act-btn" @click="onDiscardClick((me()!.hand?.length ?? 0) + i)">
            {{ card.type }}（木牛流马）
          </button>
        </template>
      </template>
    </template>

    <!-- 出牌阶段 - 选目标 -->
    <template v-else-if="step === 'pick-target' && selectedAction">
      <div class="prompt">{{ selectedAction.label }}，选择目标：</div>
      <button
        v-for="tid in selectedAction.targets"
        :key="tid"
        class="act-btn"
        @click="onTargetClick(tid)"
      >
        {{ playerNameOf(tid) }}
      </button>
      <button class="act-btn" @click="cancel">取消</button>
    </template>

    <!-- 出牌阶段 - 选指定牌 -->
    <template v-else-if="step === 'pick-card'">
      <div class="prompt">选择指定目标 {{ playerNameOf(selectedTargetId) }} 的牌：</div>
      <button
        v-for="opt in removableCards[selectedTargetId]"
        :key="opt.id"
        class="act-btn"
        @click="onCardOptionClick(opt)"
      >
        {{ opt.label }}
      </button>
      <button class="act-btn" @click="cancel">取消</button>
    </template>

    <!-- 出牌阶段 - 正常动作 -->
    <template v-else-if="actions.length > 0">
      <div class="prompt">你的回合，选择动作：</div>
      <button
        v-for="(action, i) in actions"
        :key="i"
        class="act-btn"
        :class="{ primary: action.type === 'end' }"
        @click="onActionClick(i)"
      >
        {{ action.label }}
      </button>
    </template>

    <!-- 等待中 -->
    <template v-else>
      <div class="idle">等待其他玩家行动…</div>
    </template>
  </div>
</template>
