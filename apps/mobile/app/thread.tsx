import { ChatMarkdown } from "@rakazo/chat-ui/native";
import { abortableDelay } from "@rakazo/core";
import { Link, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, AppState, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { NativeSymbol } from "../components/native-symbol";
import {
  applyMobileThreadEvent,
  blockText,
  type MobileMessage,
  type MobileMessagePage,
  type MobileSnapshot,
  mergeMobileSnapshot,
  prependMobileMessagePage,
  rpc,
  subscribeThread,
} from "../lib/api";
import { confirmDeleteBot } from "../lib/bot-lifecycle";

export default function Thread() {
  const navigation = useNavigation();
  const router = useRouter();
  const { botId, name } = useLocalSearchParams<{ botId?: string; name?: string }>();
  const scroll = useRef<ScrollView>(null);
  const loadingOlderContent = useRef(false);
  const expandedHistoryThread = useRef<string | null>(null);
  const [snap, setSnap] = useState<MobileSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name || "Thread",
      headerRight: () => (
        <Pressable accessibilityLabel="Bot actions" hitSlop={8} onPress={showBotActions}>
          <NativeSymbol ios="ellipsis" android="ellipsis-horizontal" size={21} color="#ECECEE" />
        </Pressable>
      ),
    });
  }, [botId, name, navigation]);

  function leaveBot() {
    router.dismissAll();
    router.replace("/");
  }

  function showBotActions() {
    if (!botId) return;
    const bot = { id: botId, name: name || "Bot" };
    Alert.alert(bot.name, "Archive keeps everything and can be undone. Delete is permanent.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        onPress: () =>
          void rpc("bots/archive", { botId })
            .then(leaveBot)
            .catch((error) =>
              Alert.alert(
                "Could not archive bot",
                error instanceof Error ? error.message : "Try again.",
              ),
            ),
      },
      { text: "Delete…", style: "destructive", onPress: () => confirmDeleteBot(bot, leaveBot) },
    ]);
  }

  async function refresh() {
    if (!botId) return;
    const next = await rpc<MobileSnapshot>("threads/get", { botId });
    setSnap((prev) =>
      mergeMobileSnapshot(prev, next, expandedHistoryThread.current === next.threadId),
    );
    return next;
  }

  async function loadOlderMessages() {
    if (!botId || snap?.olderCursor == null || loadingOlder) return;
    loadingOlderContent.current = true;
    setLoadingOlder(true);
    try {
      const page = await rpc<MobileMessagePage>("threads/messages", {
        botId,
        before: snap.olderCursor,
      });
      expandedHistoryThread.current = page.threadId;
      setSnap((prev) => prependMobileMessagePage(prev, page));
    } catch (err) {
      loadingOlderContent.current = false;
      setError(err instanceof Error ? err.message : "Could not load earlier messages");
    } finally {
      setLoadingOlder(false);
    }
  }

  const markReadIfVisible = useCallback(() => {
    if (!botId || AppState.currentState !== "active" || !navigation.isFocused()) return;
    void rpc("threads/markRead", { botId }).catch(() => undefined);
  }, [botId, navigation]);

  // Covers returning from a pushed screen; the AppState listener covers returning from background.
  useFocusEffect(
    useCallback(() => {
      markReadIfVisible();
    }, [markReadIfVisible]),
  );

  useEffect(() => {
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") markReadIfVisible();
    });
    return () => appState.remove();
  }, [markReadIfVisible]);

  useEffect(() => {
    if (!botId) return;
    expandedHistoryThread.current = null;
    const abort = new AbortController();
    void (async () => {
      const next = await refresh().catch((err: Error) => {
        setError(err.message);
        return null;
      });
      if (abort.signal.aborted) return;
      let cursor = next?.cursor ?? -1;
      let retryMs = 250;
      while (!abort.signal.aborted) {
        try {
          await subscribeThread(
            botId,
            cursor,
            (event) => {
              cursor = Math.max(cursor, event.seq ?? -1);
              retryMs = 250;
              if (
                event.type === "thread.progress" ||
                event.type === "thread.message.created" ||
                event.type === "thread.message.updated" ||
                event.type === "thread.subagent" ||
                event.type === "agent.tool.called" ||
                event.type === "run.waiting_input"
              ) {
                setSnap((prev) => applyMobileThreadEvent(prev, event));
              }
              if (event.type === "thread.message.created" && event.payload?.role === "bot") {
                markReadIfVisible();
              }
              if (event.type === "run.completed") {
                void refresh().catch(() => undefined);
              }
            },
            abort.signal,
          );
        } catch {
          // A full refresh reconciles visible state; the event cursor still resumes without gaps.
        }
        if (abort.signal.aborted) break;
        await refresh().catch(() => undefined);
        await abortableDelay(retryMs, abort.signal);
        retryMs = Math.min(retryMs * 2, 5_000);
      }
    })();
    return () => {
      abort.abort();
    };
  }, [botId, markReadIfVisible]);

  async function send() {
    if (!botId || !draft.trim()) return;
    const text = draft;
    setDraft("");
    await rpc("threads/send", { botId, text });
    await refresh();
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000", paddingHorizontal: 20, paddingBottom: 24 }}>
      {error ? <Text style={{ color: "#8E8E93", marginTop: 12 }}>{error}</Text> : null}
      <ScrollView
        ref={scroll}
        style={{ flex: 1, marginTop: 8 }}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onContentSizeChange={() => {
          if (loadingOlderContent.current) {
            loadingOlderContent.current = false;
            return;
          }
          scroll.current?.scrollToEnd({ animated: false });
        }}
      >
        {snap?.olderCursor != null ? (
          <Pressable
            disabled={loadingOlder}
            onPress={() => void loadOlderMessages()}
            style={{ alignSelf: "center", paddingHorizontal: 12, paddingVertical: 10 }}
          >
            <Text style={{ color: "#85858A", fontSize: 13 }}>
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </Text>
          </Pressable>
        ) : null}
        {(snap?.messages ?? []).map((message) => (
          <View
            key={message.id}
            style={{
              marginTop: 12,
              width: "100%",
              flexDirection: "row",
              justifyContent: message.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <MessageBubble
              message={message}
              onOpenBot={(id, botName) =>
                router.push({ pathname: "/thread", params: { botId: id, name: botName } })
              }
            />
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message…"
          placeholderTextColor="#6C6C70"
          keyboardAppearance="dark"
          returnKeyType="send"
          onSubmitEditing={() => void send()}
          style={{
            flex: 1,
            color: "#ECECEE",
            backgroundColor: "#131315",
            borderRadius: 20,
            paddingHorizontal: 14,
            height: 44,
          }}
        />
        <Pressable
          onPress={() => void send()}
          style={{
            backgroundColor: "#F1F1EF",
            borderRadius: 22,
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <NativeSymbol ios="arrow.up" android="arrow-up" size={18} color="#17171A" />
        </Pressable>
      </View>
      <Link
        href={{ pathname: "/computer", params: { botId: botId ?? "", name: name ?? "Bot" } }}
        asChild
      >
        <Pressable style={{ marginTop: 16 }}>
          <Text style={{ color: "#C9C9CE" }}>Open computer →</Text>
        </Pressable>
      </Link>
    </View>
  );
}

function commsKindLabel(block: MobileMessage["blocks"][number]) {
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
  return "tool";
}

function CommsPill({
  block,
  onOpenBot,
}: {
  block: MobileMessage["blocks"][number];
  onOpenBot: (botId: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const running = block.status === "running" || (!block.status && block.kind !== "child_bot");
  const failed = block.status === "failed";
  const label = block.name || commsKindLabel(block);
  return (
    <View style={{ width: "90%" }}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: "#2A2A2F",
          backgroundColor: "#17171A",
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: failed ? "#E65707" : running ? "#F5A03C" : "#4ECB71",
          }}
        />
        <Text style={{ color: "#ECECEE", fontSize: 13, maxWidth: 180 }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ color: "#85858A", fontSize: 12 }}>{commsKindLabel(block)}</Text>
      </Pressable>
      {open ? (
        <View
          style={{
            marginTop: 8,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#232326",
            backgroundColor: "#17171A",
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          {block.kind === "subagent" ? (
            <>
              {block.task ? (
                <Text style={{ color: "#85858A", marginBottom: 8 }}>{block.task}</Text>
              ) : null}
              {block.result || block.progress ? (
                <ChatMarkdown streaming={running}>
                  {block.result || block.progress || ""}
                </ChatMarkdown>
              ) : (
                <Text style={{ color: "#85858A" }}>No messages from this helper yet.</Text>
              )}
            </>
          ) : null}
          {block.kind === "child_bot" ? (
            <>
              <Text style={{ color: "#A8A8AD", lineHeight: 21 }}>
                {block.status === "archived"
                  ? "Archived this bot. Its chat, memory, and files are preserved."
                  : block.status === "deleted"
                    ? "Removed this bot, including its chat, computer, and memory."
                    : block.title || "Opened its own thread. Tap to switch."}
              </Text>
              {block.status === "created" || !block.status ? (
                <Pressable
                  onPress={() => onOpenBot(block.botId ?? "", block.name ?? "Bot")}
                  style={{ marginTop: 12 }}
                >
                  <Text style={{ color: "#F1F1EF" }}>Open {block.name || "bot"}</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {block.kind === "tool" ? (
            <>
              <Text style={{ color: "#ECECEE", fontFamily: "monospace" }}>{block.name}</Text>
              {block.args ? (
                <Text style={{ color: "#85858A", marginTop: 8, fontFamily: "monospace" }}>
                  {JSON.stringify(block.args, null, 2)}
                </Text>
              ) : null}
              {block.result ? (
                <View style={{ marginTop: 8 }}>
                  <ChatMarkdown>{block.result}</ChatMarkdown>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function MessageBubble({
  message,
  onOpenBot,
}: {
  message: MobileMessage;
  onOpenBot: (botId: string, name: string) => void;
}) {
  const special = message.blocks.find(
    (block) => block.kind === "subagent" || block.kind === "child_bot" || block.kind === "tool",
  );
  if (special) {
    return <CommsPill block={special} onOpenBot={onOpenBot} />;
  }
  return (
    <View
      style={{
        flexShrink: 1,
        minWidth: 0,
        maxWidth: "85%",
        backgroundColor: message.role === "user" ? "#F1F1EF" : "#1A1A1D",
        padding: 12,
        borderRadius: 20,
      }}
    >
      {message.role === "user" ? (
        <Text style={{ color: "#1A1A1A", fontSize: 15.5, lineHeight: 23 }}>
          {blockText(message)}
        </Text>
      ) : (
        <ChatMarkdown streaming={message.id.startsWith("progress:")}>
          {blockText(message)}
        </ChatMarkdown>
      )}
    </View>
  );
}
