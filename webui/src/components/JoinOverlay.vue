<script setup lang="ts">
import { ref } from "vue";
import { useGameConnection } from "../composables/useGameConnection.js";

const { playerId, joinGame } = useGameConnection();
const nameInput = ref("");
const visible = ref(true);

const submit = () => {
  const name = nameInput.value.trim().slice(0, 20);
  if (!name) return;
  joinGame(name);
  visible.value = false;
};

defineExpose({ show: () => (visible.value = true), hide: () => (visible.value = false) });
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && !playerId" class="overlay">
      <div class="modal">
        <h2>加入房间</h2>
        <input
          v-model="nameInput"
          placeholder="输入你的名字"
          maxlength="20"
          @keydown.enter="submit"
          autofocus
        />
        <button class="primary" @click="submit">加入</button>
        <p class="hint">
          输入名字后加入对局。若你之前掉线过，请输入同样的名字即可自动重连。
        </p>
      </div>
    </div>
  </Teleport>
</template>
