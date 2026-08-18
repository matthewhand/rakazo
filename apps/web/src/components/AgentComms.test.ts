import { describe, expect, it } from "vitest";
import { isCommsBlock, redactDisplayedArgs } from "./AgentComms.js";

describe("comms pills", () => {
  it("treats helper, child-bot, and tool blocks as comms", () => {
    expect(isCommsBlock({ kind: "text", text: "hi" })).toBe(false);
    expect(
      isCommsBlock({ kind: "subagent", agentId: "a1", name: "Helper", task: " dig", status: "running" }),
    ).toBe(true);
    expect(
      isCommsBlock({ kind: "child_bot", botId: "b1", name: "Child", status: "created" }),
    ).toBe(true);
    expect(
      isCommsBlock({ kind: "tool", executionId: "e1", name: "notes.write", status: "running" }),
    ).toBe(true);
  });

  it("redacts common token shapes from displayed tool args", () => {
    const rendered = redactDisplayedArgs({
      header: "Bearer sk-or-v1-secretvalue",
      key: "sk-proj-abcdefghijklmnopqrstuvwxyz",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart",
      path: "hello.md",
    });
    expect(rendered).toContain("hello.md");
    expect(rendered).not.toContain("sk-or-v1-secretvalue");
    expect(rendered).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
    expect(rendered).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(rendered).toContain("[redacted]");
    expect(rendered).toContain("Bearer [redacted]");
  });
});
