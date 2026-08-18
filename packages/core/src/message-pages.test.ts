import { describe, expect, it } from "vitest";
import { mergeMessagePages, mergeThreadHistory } from "./message-pages.js";

describe("mergeMessagePages", () => {
  it("keeps loaded history and takes live tool pills from the recent page", () => {
    const merged = mergeMessagePages(
      [
        { id: "m-0", seq: 0 },
        { id: "tool:exec-1", seq: 4 },
        { id: "progress:run-1", seq: 5 },
      ],
      [
        { id: "m-1", seq: 1 },
        { id: "tool:exec-1", seq: 6 },
      ],
    );
    expect(merged.map((message) => message.id)).toEqual(["m-0", "m-1", "tool:exec-1"]);
    expect(merged.find((message) => message.id === "tool:exec-1")?.seq).toBe(6);
  });

  it("drops previous live tool pills that the recent snapshot omitted", () => {
    const merged = mergeMessagePages(
      [
        { id: "m-0", seq: 0 },
        { id: "tool:stale", seq: 4 },
      ],
      [{ id: "m-1", seq: 1 }],
    );
    expect(merged.map((message) => message.id)).toEqual(["m-0", "m-1"]);
  });
});

describe("mergeThreadHistory", () => {
  it("preserves the older-history cursor while replacing live comms from recent", () => {
    const next = mergeThreadHistory(
      {
        threadId: "t1",
        olderCursor: 0,
        messages: [
          { id: "m-0", seq: 0 },
          { id: "tool:exec-1", seq: 3 },
        ],
      },
      {
        threadId: "t1",
        olderCursor: 2,
        messages: [
          { id: "m-2", seq: 2 },
          { id: "tool:exec-2", seq: 4 },
        ],
      },
      true,
    );
    expect(next.olderCursor).toBe(0);
    expect(next.messages.map((message) => message.id)).toEqual(["m-0", "m-2", "tool:exec-2"]);
  });
});
