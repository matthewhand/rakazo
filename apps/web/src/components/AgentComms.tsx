import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { MessageBlock } from "@rakazo/contracts";
import { useEffect, useState } from "react";

type CommsBlock = Extract<MessageBlock, { kind: "subagent" | "child_bot" | "tool" }>;

export function isCommsBlock(block: MessageBlock): block is CommsBlock {
  return block.kind === "subagent" || block.kind === "child_bot" || block.kind === "tool";
}

export function AgentCommsPill({
  block,
  onOpenBot,
}: {
  block: CommsBlock;
  onOpenBot?: (botId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const running =
    (block.kind === "subagent" && block.status === "running") ||
    (block.kind === "tool" && (block.status ?? "running") === "running");
  const failed =
    (block.kind === "subagent" && block.status === "failed") ||
    (block.kind === "tool" && block.status === "failed");
  const label =
    block.kind === "tool" ? shortToolName(block.name) : block.name || commsKindLabel(block);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#2A2A2F] bg-[#17171A] px-3 py-1.5 text-left text-[13px] text-[#ECECEE] hover:border-[#3C3C40]"
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background: failed ? "#E65707" : running ? "#F5A03C" : "#4ECB71",
            animation: running ? "rkPulse 1.2s ease-in-out infinite" : undefined,
          }}
        />
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-[12px] text-[#85858A]">{commsKindLabel(block)}</span>
      </button>
      {open ? (
        <AgentCommsPopup
          block={block}
          onClose={() => setOpen(false)}
          onOpenBot={
            block.kind === "child_bot"
              ? () => {
                  setOpen(false);
                  onOpenBot?.(block.botId);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function AgentCommsPopup({
  block,
  onClose,
  onOpenBot,
}: {
  block: CommsBlock;
  onClose: () => void;
  onOpenBot?: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close comms"
        className="absolute inset-0 bg-[rgba(4,4,5,.62)]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={commsTitle(block)}
        className="relative flex max-h-[min(640px,90vh)] w-[min(560px,100%)] flex-col overflow-hidden rounded-[22px] border border-[#232326] bg-[#141416] shadow-[0_40px_90px_rgba(0,0,0,.55)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#1C1C1E] px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-[16px] font-medium text-[#F1F1F2]">
              {commsTitle(block)}
            </div>
            <div className="mt-1 text-[13px] text-[#85858A]">{commsKindLabel(block)}</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[#85858A]">
            ✕
          </button>
        </div>
        <div className="rk-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[14.5px] leading-[1.5] text-[#C9C9CE]">
          {block.kind === "subagent" ? (
            <>
              {block.task ? (
                <section className="mb-4">
                  <h4 className="mb-1 text-[12.5px] uppercase tracking-wide text-[#6C6C70]">
                    Task
                  </h4>
                  <p className="text-[#ECECEE]">{block.task}</p>
                </section>
              ) : null}
              {block.progress || block.result ? (
                <section>
                  <h4 className="mb-1 text-[12.5px] uppercase tracking-wide text-[#6C6C70]">
                    {block.status === "running" ? "Live comms" : "Result"}
                  </h4>
                  <ChatMarkdown streaming={block.status === "running"}>
                    {block.result || block.progress || ""}
                  </ChatMarkdown>
                </section>
              ) : (
                <p className="text-[#85858A]">No messages from this helper yet.</p>
              )}
            </>
          ) : null}
          {block.kind === "child_bot" ? (
            <>
              <p>
                {block.status === "archived"
                  ? "Archived this bot. Its chat, memory, and files are preserved."
                  : block.status === "deleted"
                    ? "Removed this bot, including its chat, computer, and memory."
                    : block.title || "Opened its own thread."}
              </p>
              {onOpenBot && block.status === "created" ? (
                <button
                  type="button"
                  onClick={onOpenBot}
                  className="mt-4 rounded-full bg-[#F1F1EF] px-4 py-2 text-[14px] text-[#17171A]"
                >
                  Open {block.name}
                </button>
              ) : null}
            </>
          ) : null}
          {block.kind === "tool" ? (
            <>
              <section className="mb-4">
                <h4 className="mb-1 text-[12.5px] uppercase tracking-wide text-[#6C6C70]">Tool</h4>
                <p className="font-mono text-[#ECECEE]">{block.name}</p>
              </section>
              {block.args && Object.keys(block.args).length > 0 ? (
                <section>
                  <h4 className="mb-1 text-[12.5px] uppercase tracking-wide text-[#6C6C70]">
                    Arguments
                  </h4>
                  <pre className="overflow-x-auto rounded-xl bg-[#101012] px-3 py-3 font-mono text-[12.5px] text-[#C9C9CE]">
                    {redactDisplayedArgs(block.args)}
                  </pre>
                </section>
              ) : (
                <p className="text-[#85858A]">No arguments recorded.</p>
              )}
              {block.result ? (
                <section className="mt-4">
                  <h4 className="mb-1 text-[12.5px] uppercase tracking-wide text-[#6C6C70]">
                    Result
                  </h4>
                  <ChatMarkdown>{block.result}</ChatMarkdown>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function commsTitle(block: CommsBlock) {
  if (block.kind === "tool") return shortToolName(block.name);
  return block.name || commsKindLabel(block);
}

function commsKindLabel(block: CommsBlock) {
  if (block.kind === "subagent") {
    if (block.status === "failed") return "failed";
    if (block.status === "completed") return "helper";
    return "working";
  }
  if (block.kind === "child_bot") {
    if (block.status === "archived") return "archived";
    if (block.status === "deleted") return "deleted";
    return "bot";
  }
  if (block.status === "failed") return "failed";
  if (block.status === "completed") return "tool";
  return "tool";
}

function shortToolName(name: string) {
  const parts = name.split(".");
  return parts[parts.length - 1] || name;
}

function redactDisplayedArgs(args: Record<string, unknown>) {
  return JSON.stringify(args, null, 2)
    .replace(/sk-or-v1-[a-zA-Z0-9]+/g, "[redacted]")
    .replace(/sk-[a-zA-Z0-9-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[redacted]");
}
