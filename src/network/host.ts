import { GameServer } from "./server.js";

const valueOf = (name: string, fallback: string): string => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const playerCount = Number.parseInt(valueOf("players", "2"), 10);
const port = Number.parseInt(valueOf("port", "9527"), 10);
const openingHandCount = Number.parseInt(valueOf("opening-hand", "4"), 10);
if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) throw new Error("--players 必须为 2 到 6");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port 无效");
await new GameServer({ host: valueOf("host", "0.0.0.0"), port, playerCount, openingHandCount }).listen();
