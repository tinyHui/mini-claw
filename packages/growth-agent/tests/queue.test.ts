import { describe, expect, it } from "vitest";
import { HeavyJobQueue } from "../src/queue.js";

describe("HeavyJobQueue", () => {
  it("serializes heavy jobs", async () => {
    const queue = new HeavyJobQueue();
    const events: string[] = [];
    const first = queue.enqueue("one", async () => {
      events.push("one:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push("one:end");
    });
    const second = queue.enqueue("two", async () => {
      events.push("two:start");
      events.push("two:end");
    });
    await Promise.all([first, second]);
    expect(events).toEqual(["one:start", "one:end", "two:start", "two:end"]);
  });
});
