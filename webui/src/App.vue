<script setup lang="ts">
import { onMounted } from "vue";
import { useGameConnection } from "./composables/useGameConnection.js";
import TopBar from "./components/TopBar.vue";
import JoinOverlay from "./components/JoinOverlay.vue";
import Lobby from "./components/Lobby.vue";
import Battlefield from "./components/Battlefield.vue";
import GameLog from "./components/GameLog.vue";
import ActionPanel from "./components/ActionPanel.vue";
import InteractionPanel from "./components/InteractionPanel.vue";
import MyHand from "./components/MyHand.vue";
import GameOver from "./components/GameOver.vue";

const { inLobby, snapshot, connected } = useGameConnection();

onMounted(() => {
  // 首次加载时自动连接
  if (!connected.value) {
    // useGameConnection 内部会自动 connect()
  }
});
</script>

<template>
  <TopBar />

  <main>
    <!-- 大厅 -->
    <Lobby v-if="inLobby" />

    <!-- 对局 -->
    <template v-if="!inLobby && snapshot">
      <Battlefield />
      <GameLog />
      <InteractionPanel />
      <ActionPanel />
      <MyHand />
    </template>
  </main>

  <!-- 弹窗 -->
  <JoinOverlay />
  <GameOver />
</template>
