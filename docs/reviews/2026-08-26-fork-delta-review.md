# Skeptical review: fork delta vs upstream (12 commits, review only)

**Scope.** The 12 commits this fork (`matthewhand/rakazo`) carries on top of its upstream fork
point `c9fc800` ("Add built-in history compaction without Supermemory (#112)"): fork PRs #6–#11
plus their feature commits. The fork is also ~277 commits behind upstream `main`; per the review
mandate, that drift was **not** rebased or evaluated — only the fork's own additions were.
Roughly +3,682 / −362 lines across 44 files.

**Method.** Full read of the delta diff, cross-checked against the surrounding code on this
checkout (executor, connector stack, destination emulator, secret redaction paths), plus the
fork's GitHub Actions history. Verified locally at the fork tip: all 6 unit-test files touched
by the delta pass (78/78 — `mcp-client`, core `events`, web `screen-url`/`thread-events`,
mobile `api`/`computer`), and `pnpm lint` fails with 22 errors, all in delta-touched files,
matching the red CI on `main`. No code changes are proposed in this PR — it is review-only and
must not be merged into any release flow.

**Delta contents at a glance**

| Fork PR | Change |
|---|---|
| #6 | Native MCP connector: `McpClient`, settings API (`mcp.list/update/status`), DB column, docs |
| #7 | Live "agent tool call" pills across web and mobile threads; `agent.tool.called` now carries args/status/result |
| #8 | Mobile noVNC loopback guard; web `screen-url` extraction with tests |
| #9 | e2e expansion (MCP tab, comms popups, extra screenshots) |
| #10 | Compose/Dockerfile changes, `.gitattributes` LF pins, `allowedHosts: true` |
| #11 | Stop tracking `docker-compose.override.yml` |

---

## Verdict

The delta contains genuinely useful work — the native MCP integration is contract-first with
real tests, and the noVNC guard fixes an actual LAN exposure bug. But it is **not in a
mergeable state as-is**, for three reasons that compound:

1. **The fork's `main` is red.** The `Lint` job fails on the tip commit with violations in ~14
   of the delta's own files; PRs #10/#11 were merged over failing CI.
2. **The "hardening" commit (PR #10) de-hardens.** It runs three containers as root, injects the
   entire `.env` into the web container, and disables the Vite preview host allowlist — each the
   opposite of its stated intent, and each looks like a machine-local workaround promoted into
   tracked files at the same time the local override file was untracked (PR #11).
3. **Secret handling for MCP contradicts the repo's own architecture.** MCP headers/env
   (bearer tokens) are stored in plaintext in `deployment_settings` even though an
   `EncryptedSecretStore` exists, and a rename heuristic in `mcp.update` can silently re-attach
   one server's stored credentials to a differently-named server.

Details below, ordered by severity. Positives are at the end and are real.

---

## High severity

### H1. Fork `main` fails its own lint gate; merges landed over red CI

CI run 32639485673 (the PR #11 merge commit, current `main` tip): Production builds, Unit tests,
Typecheck, Postgres journeys, and Web E2E all pass — but **Lint fails** with errors introduced by
this delta, including:

- `packages/contracts/src/rpc.ts:19` — unused import (`McpServerConfigSchema` is imported but
  only the list/public/status schemas are used).
- `apps/api/src/app.ts:110` and `apps/worker/src/index.ts:60` — `noImplicitAnyLet`
  (`let mcpConfig;` with no type).
- `apps/web/src/components/AgentComms.tsx:81` and `apps/web/src/pages/PluginsOverlay.tsx:143` —
  `noStaticElementInteractions` (click-to-dismiss backdrop `div`s).
- `apps/web/vite.config.ts:119` — unused variable (`previewHost` is computed but no longer used
  after `allowedHosts: true`).
- Formatter drift in ~9 more files (`executor.ts`, `McpServersTab.tsx`, `golden.spec.ts`,
  `screen-url.ts` + test, mobile `api.ts`, …).

This is a process failure as much as a code one: `CONTRIBUTING.md` documents `pnpm lint` as a CI
gate, and two merges ignored it. Most of the errors are `biome check --write` away, but the two
a11y errors and the unused `previewHost` point at real issues (H3, M6).

### H2. PR #10 ("compose/Dockerfile hardening") weakens the deployment posture

`infra/compose/docker-compose.yml`:

- `user: "0"` added to `api`, `worker`, and `supervisor` — all three now run as **root** inside
  their containers. The compose `Dockerfile` presumably drops privileges for a reason; this
  reverses it silently.
- `env_file: ../../.env` added to the **web** service. The web preview container needs a handful
  of variables; this hands it the entire deployment secret set (`DATABASE_URL`,
  `ENCRYPTION_KEY`, provider API keys). Any compromise of the least-trusted, internet-facing
  container now yields every secret. It also makes `compose up` hard-fail when `.env` is absent.
- `supervisor` gains `image: compose-api` *and* keeps its own `build:` stanza. `compose-api` is
  also the default image tag compose derives for the `api` service, so two services race to
  build-and-tag the same image name with different Dockerfiles; last build wins. This only makes
  sense as a local machine hack ("reuse the api image, override workdir/command") — which is
  precisely what PR #11 says should live in the now-untracked `docker-compose.override.yml`.
- Three trailing blank lines appended (also flagged by lint) — a small tell that this file was
  edited in anger rather than reviewed.

Given AGENTS.md marks sandbox boundaries and secret handling as security-sensitive, this commit
should be reverted to override-file territory, not carried as tracked "hardening".

### H3. `allowedHosts: true` disables the Vite preview host allowlist

```158:162:apps/web/vite.config.ts
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.WEB_PORT ?? 5173),
    allowedHosts: true,
```

The allowlist (`previewHost`, still computed a few lines up, now dead) existed to block
DNS-rebinding-style access to a `0.0.0.0`-bound preview server. `true` accepts any `Host`
header. Combined with H2's decision to feed the web container the full `.env`, the blast radius
of the preview server grew in both directions in the same PR. If a specific LAN hostname needed
allowing, it should have been added to the list (or made configurable), not the list removed.

### H4. Stdio MCP servers turn the owner-facing web API into host command execution

`mcp.update` (deployment-owner-gated) accepts `type: "stdio"` with arbitrary `command`, `args`,
and `env`; `McpClient` then spawns that command **inside the API and worker processes** — outside
every sandbox boundary the product otherwise enforces. `docs/mcp-integration.md` concedes "MCP
servers run with the same permissions as Rakazo".

Concretely: a stolen deployment-owner session cookie is now remote code execution on the host,
via a first-class, documented RPC. The delta does mitigate the *child's* environment (see
positives, P1), but not the fact of spawning. Upstream chose Composio (brokered, no host exec)
as the only plugin path; this fork's divergence deserves at least:

- an explicit deployment-level opt-in (e.g. `MCP_ALLOW_STDIO=1`) so remote-only deployments can
  keep stdio off entirely, and/or
- restricting `stdio` to env/file configuration (operator-controlled) while the web UI manages
  only `http`/`sse`.

### H5. MCP credentials are stored in plaintext, bypassing `EncryptedSecretStore`

The migration adds `deployment_settings.mcpServers TEXT`, and `mcp.update` serializes the full
server configs — **including `headers` (typically `Authorization: Bearer …`) and stdio `env`** —
as plaintext JSON into that column. The repo already has an `EncryptedSecretStore` (used for
model credentials via `deploymentModelCredentialCipher` in the same table) — the delta chose not
to use it.

Consequences: a DB dump leaks every MCP token; DB backups become secret-bearing; and because
these tokens are never added to `runSecrets`, the executor's redaction pipeline
(`redactSecrets`/`containsSecret`) will not scrub them if an MCP tool echoes its own
authorization back in a result (which now gets persisted — see M2).

### H6. The `mcp.update` rename heuristic can silently re-point stored credentials

```214:216:apps/api/src/router.ts
        if (removed.length === 1 && added.length === 1 && removed[0] && added[0]) {
          previous.set(added[0].name, removed[0]);
        }
```

Intent: preserve secrets across a rename. Effect: **any** update that removes one server and
adds one server in the same call grafts the removed server's `headers`/`env` onto the added one
— even when they are unrelated. Delete `notion` (holding a Notion bearer token) while adding
`scraper` pointing at a third-party URL, and the Notion token is silently sent to the scraper's
URL on the next connect. The current UI happens to save deletes and adds separately, so the API
contract is the exposure, not the UI — but contracts outlive UIs. A rename should be explicit
(`renameFrom` field) or not supported.

---

## Medium severity

### M1. `mcp.list` / `mcp.status` are member-visible; only headers/env are masked

Both endpoints are `authed` but not owner-gated (documented as intentional). The public schema
strips `headers`/`env` — good — but **URLs and stdio command/args are shown to every signed-in
member**, and real-world MCP configs frequently embed tokens there (`https://mcp.example/?key=…`,
`npx server --token …`). Status errors are also passed through verbatim. Either owner-gate the
tab or mask URL query strings/args the same way headers are masked.

### M2. `agent.tool.called` now persists full args and results, with thin and inconsistent redaction

Before: the event carried `{name, executionId}`. After: full `args` plus up to 4,000 chars of
`result`, per call, appended to the events table (twice per tool: `running` then
`completed`/`failed`) and replayed to every thread viewer.

- Server-side redaction is `redactRecord(args, runSecrets)` — it only removes *known* run
  secrets (model keys etc.). Anything sensitive the user typed, or MCP tokens (H5), pass
  through and are persisted indefinitely.
- Web adds `redactDisplayedArgs` — a display-time regex for `sk-*`, `Bearer *`, JWTs. This is
  cosmetic: the unredacted payload already left the server and sits in the DB and in every
  client's event stream. The regex also over-matches (any `sk-…` token, e.g. the string
  `sk-learn`, renders as `[redacted]`) and under-matches (every other secret format).
- **Mobile renders `JSON.stringify(block.args)` with no redaction at all** — the two surfaces
  disagree about what the user is allowed to see.

Also worth a decision, not an accident: the snapshot endpoint now replays `agent.tool.called`
events from the *latest finished* run forever (new query per snapshot), so the last run's pills
persist indefinitely while all earlier runs' pills vanish — inconsistent history semantics that
will read as a bug.

### M3. `McpClient` hot paths hit the DB and never retry failed servers

`initialize()` runs on **every** `discoverTools`, `execute`, and `getServerStatus` call, and its
`refreshIfStale` re-invokes the config source — a `deployment_settings` DB read per tool call,
serialized through a single promise gate (a global lock across concurrent tool executions).
Meanwhile the McpServersTab polls `mcp.status` every 5 s per open overlay, each poll paying the
same cost. And because `initPromise` is cached and failures only recorded in `connectionErrors`,
a server that failed to connect is **never retried** until the config fingerprint changes or the
process restarts — the status tab will show `error` forever even after the server recovers.

### M4. `CompositeConnector.execute` can double-execute and has a dangerous ownership default

```919:2926:packages/adapters/src/composio-connector.ts
    if (this.mcp && this.mcpOwns(call.tool)) {
      try {
        yield* this.mcp.execute(call, context);
        return;
      } catch (error) {
        console.error(`[MCP] Execution failed for ${call.tool}:`, error);
      }
    }
```

If the MCP generator yields some events and *then* throws, the catch falls through to Composio,
which executes the same tool name again — duplicated side effects with interleaved event
streams. (In practice `McpClient.execute` converts errors to `error` events, so the throw path
is nearly dead — which is an argument for removing the fallthrough, not keeping it.) The
`mcpOwns` fallback `tool.includes(".")` (used when a caller passes an MCP-shaped object without
`ownsTool`) would claim every dotted tool name; the real client's longest-prefix `ownsTool` is
correct, but the default should fail closed.

Also note: API and worker each construct an independent `McpClient`, so every stdio server is
spawned **twice** per deployment (two child processes, two SSE connections), and
`execute()` ignores `context.signal` — a cancelled run does not cancel an in-flight MCP call
(the SDK's own 60 s default timeout is the only bound).

### M5. UI/effective-config mismatch: env/file servers are invisible and silently shadow DB edits

`mcp.list` reads only the DB column, but the effective config merges file + env + DB with
first-name-wins dedupe **in that order** — so an env-configured `notion` silently shadows a
DB-configured `notion` that the owner just edited in the UI, while the UI shows (and lets the
owner edit) the ineffective DB copy, with status keyed by name reporting the *env* server's
state next to it. The tab should either display merged provenance ("from env, read-only") or
DB entries should win the dedupe.

### M6. Dialog a11y is half-done (and lint agrees)

`AgentCommsPopup` and the reworked `PluginsOverlay` add `role="dialog"`/`aria-modal`, Escape
handling, and backdrop click — but no focus trap, no initial focus, no focus restoration, and
the backdrop `div`s carry click handlers without keyboard equivalents (the exact
`noStaticElementInteractions` lint failures in H1). The Escape-collision between the MCP editor
and the overlay is solved with a `mcpEditorOpen` boolean threaded through props plus
`stopPropagation` — fragile ordering-dependent coupling; a third nesting level breaks it.

### M7. Comms pill logic is duplicated across web and mobile, and has already drifted

AGENTS.md: "Prefer shared packages for domain logic … and reusable UI." `commsKindLabel`,
running/failed derivation, and the expand/collapse presentation are implemented twice —
`apps/web/src/components/AgentComms.tsx` and inline in `apps/mobile/app/thread.tsx` — with the
status→label mapping *already* diverging (web special-cases `completed → "tool"`; mobile's
fallthrough differs), plus the redaction divergence in M2. The label/status derivation belongs
in `@rakazo/core` next to `toolBlockFromPayload` (which is properly shared and tested).

The UX also regressed in one respect worth a product decision: subagent cards previously showed
task + live streaming progress **inline**; both surfaces now collapse this behind a
tap-to-expand pill (web: a full-screen modal per tool call). Multiple concurrent tools mean
multiple clicks to see what the agent is doing.

---

## Low severity / polish

- **L1 — Popup leak in `PluginsOverlay.connect`:** the pre-opened `about:blank` OAuth window is
  only closed on abort or missing-URL paths; if `rpc.connections.begin` throws, the blank popup
  stays open.
- **L2 — No way to clear stored headers/env:** `headers: server.headers ?? prior?.headers`
  means blank-means-keep; the only way to remove a stored credential is delete + re-add the
  server. Fine as a v1, but undocumented.
- **L3 — `embeddableScreenUrl` edge cases (web):** any absolute URL whose *path* starts with
  `/novnc/` is rewritten onto the page origin, even for non-loopback hosts (a managed provider
  using that path would break); and the `catch { return url; }` fallback returns unparseable
  input unguarded (pre-existing behavior, but the extraction was the moment to fix it). The
  guard's core behavior change is correct and well-tested (P3).
- **L4 — e2e softness:** `00-mcp-gallery.spec.ts` and `captureMcpServersGallery` in
  `golden.spec.ts` duplicate coverage, and both use `if (await add.isVisible().catch(() =>
  false))` conditionals — the owner-vs-member branch is never *asserted*, so a regression that
  hides the Add button from owners would still pass. The new golden prompts ("write a file…",
  "delegate to a helper…") couple test text to the scripted runtime's prompt inference; that's
  consistent with the repo's approach but each new phrase is another magic string.
- **L5 — API shape nits:** `parseMcpConfig` returns `McpClientConfig | Promise<McpClientConfig>`
  depending on arguments (callers must remember to `await`); its `prisma` parameter is typed
  with `any` args; `McpServerConfigSchema` doesn't cross-validate type↔command/url (that logic
  is duplicated imperatively in the router and again in the UI editor — a zod `superRefine`
  would centralize it).
- **L6 — Doc drift:** `docs/mcp-integration.md` is thorough (genuinely good), but it documents
  merged config sources without mentioning the shadowing behavior (M5), and the "Security
  Considerations" section says "store sensitive values in environment variables or secure
  config files" while the UI flow it recommends stores them in plaintext DB (H5).
- **L7 — `image: compose-api` + stray trailing newlines** covered under H2; the `.gitattributes`
  LF pins plus the Dockerfile `sed -i 's/\r$//'` belt-and-suspenders are pragmatic for Windows
  hosts, though the `sed` masks the hygiene problem the attributes already solve.

---

## What is genuinely good (keep these)

- **P1 — `stdioChildEnv` allowlist.** Stdio MCP children inherit only a curated env allowlist
  (`PATH`, `HOME`, locale, …) plus explicit config — `DATABASE_URL`/`ENCRYPTION_KEY` do not leak
  into child processes, and there's a test asserting it. This is the right instinct (it just
  doesn't neutralize H4).
- **P2 — Contract-first secret-safe public shape.** `McpServerPublicSchema` omits
  `headers`/`env` and exposes `hasHeaders`/`hasEnv`; list responses can't accidentally serialize
  secrets even if the storage layer changes.
- **P3 — The noVNC guard is a real fix with real tests.** Upstream behavior rewrote *any*
  loopback screen URL onto the API/page host, publishing raw loopback VNC ports onto LAN
  addresses. The delta distinguishes signed `/novnc/` capabilities (rewrite OK) from raw
  loopback ports (emulator alias only / null), extracts the logic out of `Shell.tsx` into a
  tested module, and covers both surfaces with focused unit tests.
- **P4 — Status-downgrade protection is tested at all three layers.** "A late `running` event
  must not overwrite a `completed` tool" is asserted in `packages/core`, the web reducer, and
  the mobile reducer. Progress-message preservation when a pill arrives is also tested on both
  clients.
- **P5 — Small real fixes riding along:** `run.failed`/`run.cancelled` now trigger thread
  refresh on web and mobile (stuck-spinner fix); `connectedAccountId` paginates Composio
  toolkits instead of trusting page one; the OAuth window is pre-opened synchronously (popup
  blockers) with an `AbortController` tied to unmount; the MCP emulator was upgraded from a
  fake HTTP shim to a real JSON-RPC/SSE handshake so tests exercise the actual SDK client.
- **P6 — Additive, reversible schema change.** The migration is a single nullable TEXT column;
  no backfill, no destructive change.

---

## Recommended order of remediation (if the fork continues)

1. Fix lint and restore the "green main" invariant (mechanical; H1).
2. Revert the compose/vite de-hardening or move it into untracked overrides (H2, H3).
3. Move MCP headers/env into `EncryptedSecretStore`; add them to `runSecrets`; delete the
   rename heuristic (H5, H6).
4. Gate stdio behind an env opt-in (H4).
5. Decide member visibility and mask URLs/args in `mcp.list` (M1); decide the tool-event
   retention/redaction story (M2).
6. Cache MCP config with TTL or event-driven invalidation; add failed-server retry with backoff
   (M3); remove the Composio fallthrough (M4); surface env/file servers in the UI (M5).
7. Consolidate comms-pill logic into a shared package; finish dialog a11y (M6, M7).

*Reviewed at fork tip `168e459`; fork point `c9fc800`; 12 commits, +3,682/−362 across 44 files.
Review-only — do not merge this PR, and do not treat it as approval of the delta.*
