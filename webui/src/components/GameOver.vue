<script setup lang="ts">
import { ref } from "vue";
import { useGameConnection } from "../composables/useGameConnection.js";

const { gameOverMessage, gameOverVisible, confirmNext } = useGameConnection();
const confirmed = ref(false);

const onConfirm = () => {
  confirmed.value = true;
  confirmNext();
};
</script>

<template>
  <Teleport to="body">
    <div v-if="gameOverVisible" class="overlay">
      <div class="modal">
        <h2>{{ gameOverMessage }}</h2>
        <button class="primary" :disabled="confirmed" @click="onConfirm">
          确认下一局
        </button>
        <p v-if="confirmed" class="muted">等待其他玩家确认…</p>
      </div>
    </div>
  </Teleport>
</template>
