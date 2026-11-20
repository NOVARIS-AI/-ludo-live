import { describe, expect, it } from "vitest";
import { RealtimeHub } from "../worker/index.ts";

class FakeSocket {
  attachment: any;
  sent: string[] = [];
  constructor(meta: any) { this.attachment = structuredClone(meta); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  serializeAttachment(value: any) { this.attachment = structuredClone(value); }
  send(value: string) { this.sent.push(value); }
}

function setup() {
  const one = new FakeSocket({ connectionId: "c1", userId: "p1", subscriptions: [] });
  const two = new FakeSocket({ connectionId: "c2", userId: "p2", subscriptions: [] });
  const unrelated = new FakeSocket({ connectionId: "c3", userId: "p3", subscriptions: [] });
  const sockets = [one, two, unrelated];
  const hub = new RealtimeHub({ getWebSockets: () => sockets } as never, {} as never);
  const post = (path: string, body: unknown) => hub.fetch(new Request("https://hub" + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { hub, sockets, one, two, unrelated, post };
}

describe("RealtimeHub subscription delivery", () => {
  it("delivers an entity update only to sockets subscribed to that exact entity", async () => {
    const { one, two, unrelated, post } = setup();
    await post("/subscribe", { connection_id: "c1", user_id: "p1", entity_type: "room", entity_id: "ABC123" });
    await post("/subscribe", { connection_id: "c2", user_id: "p2", entity_type: "room", entity_id: "XYZ789" });
    const result = await post("/broadcast", {
      v: 1, type: "entity.update",
      payload: { entity_type: "room", entity_id: "ABC123", data: { version: 2 } },
    });
    expect((await result.json<any>()).delivered).toBe(1);
    expect(one.sent).toHaveLength(1);
    expect(two.sent).toHaveLength(0);
    expect(unrelated.sent).toHaveLength(0);
  });

  it("does not duplicate an identical subscription", async () => {
    const { one, post } = setup();
    const subscription = { connection_id: "c1", user_id: "p1", entity_type: "room", entity_id: "ABC123" };
    await post("/subscribe", subscription);
    await post("/subscribe", subscription);
    expect(one.attachment.subscriptions).toEqual([{ type: "room", id: "ABC123" }]);
  });

  it("stops delivery after a socket unsubscribes", async () => {
    const { one, post } = setup();
    const subscription = { connection_id: "c1", user_id: "p1", entity_type: "private-chat", entity_id: "ABC123_p1" };
    await post("/subscribe", subscription);
    await post("/unsubscribe", subscription);
    await post("/broadcast", { payload: { entity_type: "private-chat", entity_id: "ABC123_p1", data: { message: "private" } } });
    expect(one.sent).toHaveLength(0);
    expect(one.attachment.subscriptions).toEqual([]);
  });
});
