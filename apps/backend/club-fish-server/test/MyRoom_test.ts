import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

// import your "app.config.ts" file here.
import appConfig from "../src/app.config";
import { MyRoomState } from "../src/rooms/schema/MyRoomState";

describe("testing your Colyseus app", () => {
  let colyseus: ColyseusTestServer;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  it("connecting into a room", async () => {
    // `room` is the server-side Room instance reference.
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});

    // `client1` is the client-side `Room` instance reference (same as JavaScript SDK)
    const client1 = await colyseus.connectTo(room, { displayName: "Finn" });

    assert.strictEqual(client1.sessionId, room.clients[0].sessionId);

    await room.waitForNextPatch();

    const player = room.state.players.get(client1.sessionId);
    assert.ok(player);
    assert.strictEqual(player.displayName, "Finn");
  });

  it("survives malformed join options", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { size: "huge" });
    assert.strictEqual(room.maxClients, 30);

    const client = await colyseus.connectTo(room, {
      displayName: 5,
      bodyColor: { a: 1 },
      currency: "lots",
      userId: [],
      equippedCosmetics: "hat",
    });

    const player = room.state.players.get(client.sessionId);
    assert.ok(player);
    assert.strictEqual(player.displayName, "anonymous");
    assert.strictEqual(player.color, "fish-#ff3650");
    assert.strictEqual(player.currency, 0);
    assert.strictEqual(player.userId, client.sessionId);
    assert.strictEqual(player.equippedHat, "");
  });

  it("ignores malformed messages without throwing", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const client = await colyseus.connectTo(room, {});

    const errors: unknown[] = [];
    room.onUncaughtException = (error) => errors.push(error);

    const malformed: [string | number, unknown][] = [
      ["chat", undefined],
      ["chat", null],
      ["chat", "just a string"],
      ["chat", { text: 123, sender: {} }],
      ["chat", { text: "   " }],
      ["equip_cosmetic", undefined],
      ["equip_cosmetic", { slot: "hat", itemId: { nested: true } }],
      ["player_selection", { not: "a choice" }],
      ["player_selection", "Rock"],
      ["color", undefined],
      ["color", 42],
      [0, undefined],
      [0, null],
      [0, { x: "1", y: NaN, tick: 1 }],
    ];
    for (const [type, payload] of malformed) client.send(type, payload);

    // A valid message sent last proves the earlier ones were all processed.
    client.send("chat", { text: "hello", sender: "Finn" });
    await client.waitForMessage("chat");
    await room.waitForNextSimulationTick();

    assert.deepStrictEqual(errors, []);
    assert.strictEqual(room.state.messages.length, 1);
    assert.strictEqual(room.state.messages[0].text, "hello");
    assert.strictEqual(room.state.players.get(client.sessionId).equippedHat, "");
  });

  it("still applies well-formed messages", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const client = await colyseus.connectTo(room, {});

    client.send("equip_cosmetic", { slot: "hat", itemId: "tophat-red" });
    client.send("color", "#9370DB");
    client.send(0, { x: 321, y: 123, tick: 7 });
    client.send("chat", { text: "done", sender: "Finn" });
    await client.waitForMessage("chat");

    const player = room.state.players.get(client.sessionId);
    // Movement is applied on the fixed simulation step, so give it a few ticks.
    for (let i = 0; i < 20 && player.x !== 321; i++) {
      await room.waitForNextSimulationTick();
    }

    assert.strictEqual(player.equippedHat, "tophat-red");
    assert.strictEqual(player.color, "fish-#9370DB");
    assert.strictEqual(player.x, 321);
    assert.strictEqual(player.y, 123);
  });
});
