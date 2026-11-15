import { Room, Client } from "@colyseus/core";
import { InputData, MyRoomState, Player, ChatMessageSchema } from "./schema/MyRoomState";

const MAX_CHAT_LENGTH = 500;
const MAX_NAME_LENGTH = 32;
const MAX_ID_LENGTH = 128;
const MAX_ROOM_SIZE = 300;
const DEFAULT_ROOM_SIZE = 30;
const RPS_CHOICES = ["Claw", "Kelp", "Coral"];

// Everything a client sends is untrusted: these helpers coerce it to a safe value.
function asString(value: unknown, maxLength: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class MyRoom extends Room<MyRoomState> {
  state = new MyRoomState();
  fixedTimeStep = 1000 / 60;

  onCreate(options: any) {
    const size = options?.size;
    this.maxClients =
      Number.isInteger(size) && size >= 1 && size <= MAX_ROOM_SIZE ? size : DEFAULT_ROOM_SIZE;

    // Persistent chat
    this.onMessage("chat", (client, message: unknown) => {
      if (!isObject(message)) return;
      const text = asString(message.text, MAX_CHAT_LENGTH).trim();
      if (!text) return;

      // Add message to state
      const chatMsg = new ChatMessageSchema();
      chatMsg.text = text;
      chatMsg.sender = asString(message.sender, MAX_NAME_LENGTH, "Anonymous");
      this.state.messages.push(chatMsg);

      // Broadcast to all clients
      this.broadcast("chat", chatMsg);
    });

    this.onMessage("equip_cosmetic", (client, message: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !isObject(message)) return;

      const itemId = asString(message.itemId, MAX_ID_LENGTH);
      if (message.slot === "hat") {
        player.equippedHat = itemId;
      } else if (message.slot === "bracelet") {
        player.equippedBracelet = itemId;
      }
    });

    // Minigame messages - RPS
    this.onMessage("player_selection", (client, selection: unknown) => {
      if (typeof selection !== "string" || !RPS_CHOICES.includes(selection)) return;
      this.broadcast("opponent move", selection, { except: client });
    });

    this.onMessage("color", (client, message: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || typeof message !== "string" || !message) return;
      player.color = `fish-${message.slice(0, MAX_NAME_LENGTH)}`;
      console.log("Server updated color to:", player.color);
    });

    this.onMessage(0, (client, payload: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !isObject(payload)) return;
      const { x, y, tick } = payload;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      player.inputQueue.push({
        x: x as number,
        y: y as number,
        tick: asFiniteNumber(tick),
      });
    });

    let elapsedTime = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;
      while (elapsedTime >= this.fixedTimeStep) {
        elapsedTime -= this.fixedTimeStep;
        this.fixedTick(this.fixedTimeStep);
      }
    });
  }

  fixedTick(timestep: number) {
    this.state.players.forEach(player => {
      let input: InputData;
      while (input = player.inputQueue.shift()) {
        player.x = input.x;
        player.y = input.y;
        player.tick = input.tick;
      }
    });
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");

    const player = new Player();
    player.x = (Math.random() * (800 - 200) + 200);
    player.y = (Math.random() * (600 - 400) + 400);

    if (!isObject(options)) options = {};
    const cosmetics = isObject(options.equippedCosmetics) ? options.equippedCosmetics : {};

    const bodyColor = asString(options.bodyColor, MAX_NAME_LENGTH) || "#ff3650";
    const displayName = asString(options.displayName, MAX_NAME_LENGTH) || "anonymous";
    const currency = asFiniteNumber(options.currency);
    const userId = asString(options.userId, MAX_ID_LENGTH) || client.sessionId;

    player.color = `fish-${bodyColor}`;
    player.displayName = displayName;
    player.currency = currency;
    player.userId = userId;
    player.equippedHat = asString(cosmetics.hat, MAX_ID_LENGTH);
    player.equippedBracelet = asString(cosmetics.bracelet, MAX_ID_LENGTH);

    this.state.players.set(client.sessionId, player);

    console.log("server color:", player.color);
    console.log("server display name:", player.displayName);
    console.log("server userId:", player.userId);

    // Trigger RPS start if room is full
    if (this.clients.length === this.maxClients) {
      this.broadcast("roomIsFull", "test msg");
    }
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.state.players.delete(client.sessionId);
      console.log(`Deleted player ${client.sessionId}`);
    }
  }

  // Defining this makes Colyseus wrap every handler in try/catch, so a bug in
  // one handler is logged instead of taking down the whole server process.
  onUncaughtException(error: Error, methodName: string) {
    console.error(`[${this.roomName}] uncaught exception in ${methodName}:`, error);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }
}
