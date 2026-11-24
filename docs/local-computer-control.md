# Local computer control (look-only)

Look-only map of how **computer control / operate / desktop automation** works in this
repo for **local** use: Docker sandboxes and host/bare-metal (`desktop` / “This Mac”).
No runtime product change accompanies this document.

Written for [open-swarm REQ-189](https://github.com/matthewhand/open-swarm/issues/645).
SaaS computer backends (E2B, Daytona, Box) implement the same `SandboxProvider` contract
and are **out of scope** here. For the shared contract and those backends, see
[computer-runtime.md](./computer-runtime.md). For operators, see [self-host.md](./self-host.md).

## Mental model

```text
SPA / Electron / mobile
  -> oRPC computer.* and threads.send
  -> API (Hono) + Graphile worker
  -> one Pi agent session in the API or worker process
  -> builtin Pi tools (computer_observe, computer_act, shell, files, …)
  -> SandboxProvider
       -> DockerSandboxProvider  --HTTP--> sandbox supervisor --dockerode--> rakazo/computer:local
       -> DesktopSandboxProvider  --in-process spawn/fs--> host OS user
```

Pi is **not** installed in the computer container. Built-in tools are ordinary Pi tools, not
Claude- or MCP-specific. Any Pi-exposed model can call them. Graphical operate still needs a
model that accepts image tool results.

There is **no per-action user approval** for `computer_act`, `shell`, or file tools. The
human “Take control” path is a **viewer input lease**, not an exclusive machine lock and not
an automatic pause of an active run.

## Two local backends

| Mode | How selected | What the bot actually gets |
| --- | --- | --- |
| **Docker** (default local) | `SANDBOX_PROVIDER=docker` and `deploymentSettings.computerHost` is unset or `"docker"` | Linux desktop container: Xvfb + Fluxbox + Chromium + xdotool + noVNC. Graphical tools on. |
| **This Mac / this computer** | Electron first-run choice stores `computerHost: "this-mac"` while env stays `docker` | `HostAwareSandbox` routes to `DesktopSandboxProvider`. Shell + files as the API/worker OS user. **No live desktop, no noVNC, no `computer_act`.** |
| **Explicit desktop provider** | `SANDBOX_PROVIDER=desktop` | Same host executor as above, always. Host-choice UI is not offered. |

`sandboxKindForBot("docker", "this-mac")` returns `"desktop"`. New bot computer rows follow
that mapping in `packages/db/src/repos.ts`.

Docker is the product path for local graphical operate. Host/desktop is a trusted-user
shell, not a second graphical stack.

## Entry points

### Source checkout (`pnpm dev`)

1. Postgres via Compose (`127.0.0.1:5433`).
2. `pnpm sandbox:build` builds `rakazo/computer:local` (or the supervisor builds it on first provision).
3. `pnpm dev` starts API (`:3100`), worker, Vite (`127.0.0.1:5173`), and **supervisor on the host** (`127.0.0.1:7091`).
4. Computer containers are siblings on host Docker. noVNC ports bind `127.0.0.1:<ephemeral>`.
5. Vite proxies `/api`, `/rpc`, and `/novnc/*` to the API / localhost container ports.

Root script: `package.json` `dev` → turbo filters `@rakazo/api`, `@rakazo/worker`, `@rakazo/web`, `@rakazo/sandbox-supervisor`.

### Single-machine Compose

`infra/compose/docker-compose.yml`:

- Postgres, API, worker, web preview, supervisor (internal only), and a build-only `computer` image service.
- Supervisor mounts `/var/run/docker.sock` and `/data`. API/worker do **not** get the socket.
- `SANDBOX_SUPERVISOR_URL=http://supervisor:7091`, `SANDBOX_SCREEN_NETWORK=internal` (screen URLs use container IPs).
- Supervisor auth: `SANDBOX_SUPERVISOR_TOKEN` or fallback `BETTER_AUTH_SECRET`.

Access to the supervisor is equivalent to control of the Docker host. It is not published.

### Electron (same API)

`pnpm --filter @rakazo/desktop dev` loads the web origin. Computer UX is the web SPA.
On first launch, if the caller is the deployment owner and `SANDBOX_PROVIDER=docker`,
`HostComputerPrompt` asks Docker vs this machine. See [SPA affordances](#spa-affordances).

### Mobile

`apps/mobile/app/computer.tsx` uses the same `computer.*` RPC and embeds noVNC in a WebView.
It is a client of the same local API, not a separate control plane.

## How agents invoke computer tools

```text
User message
  threads.send (apps/api/src/router.ts)
  events.sendUserMessage + run.continue job
  worker or in-process memory queue (WAKEUP_DRIVER)
  createRunExecutor.continueRun
    acquireComputerExecutionLease (Team only)
    provisionComputer -> sandbox.provision / prepare
    PiAgentRuntime.run({ executeTool })
      model calls computer_observe / computer_act / shell / files
      applyTool -> SandboxProvider.observe / act / execute / files
      observationToolResult (metadata JSON + optional PNG)
      pruneComputerScreenshotContext keeps the last 2 screenshots
```

### Tool surface the model sees

Defined in `packages/adapters/src/builtin-tools.ts`, registered in
`packages/adapters/src/pi-runtime.ts` (`toAgentTools`). Executed in
`packages/adapters/src/executor.ts` (`applyTool`).

| Tool | Sandbox call | Notes |
| --- | --- | --- |
| `computer_observe` | `sandbox.observe` | Screenshot + cursor / window metadata |
| `computer_act` | `parseComputerActions` → `sandbox.act` | Up to 24 ordered actions; optional settle + observe |
| `open_path` | `act({ kind: "open", path })` | File or http(s) URL |
| `launch_app` | `act({ kind: "launch", application, uri? })` | Installed GUI app |
| `shell` | `sandbox.execute(["bash", "-lc", command])` | cwd defaults to bot folder (Team) or workspace root (Private) |
| `list_files` / `read_file` / `write_file` | sandbox file APIs | Team paths resolve under `bots/<bot-id>/` unless `shared/` or `bots/` |
| `attach_file` | read + artifact | Stays on disk; attached to the thread |
| `request_takeover` | **not** a sandbox call | Pi emits `takeover`, run goes `waiting_takeover` |

`computer_act` model kinds: `click`, `move`, `down`, `up`, `type`, `key`, `scroll`, `wait`.
`packages/adapters/src/computer-tools.ts` maps those to sandbox actions (`pointer`,
`clipboard`, `key`, `scroll`, `wait`).

Graphical tools are stripped when `computer.kind === "desktop"` or
`describe().capabilities.graphical` is false (`GRAPHICAL_AGENT_TOOLS` in `executor.ts`).
Host/desktop bots get shell + files only.

Teaching sessions (`apps/api/src/taught-skills.ts`) block `computer_observe` /
`computer_act` while the user records a skill.

### Docker observe / act inside the machine

Supervisor (`infra/sandboxes/supervisor/src/index.ts` + `supervisor-logic.ts`):

- Observe: `xdotool` geometry/cursor/window + ImageMagick `import -window root` → base64 PNG.
- Act: Python/xdotool batch (`containerActionStep` / `xdotoolCommand` in `computer-spec.ts`).
- Primary display `:1` from `infra/sandboxes/computer/start.sh` (Xvfb, Fluxbox, Chromium, view-only x11vnc, websockify `:6080`).
- Extra Team screens (indexes 1–7): extra Xvfb `:2`–`:8`, view port `6080+2i`, control `6081+2i`. Limit `TEAM_SCREEN_LIMIT = 8`.

`DockerSandboxProvider` is an HTTP client. Identity + screen fencing headers:

- `Authorization: Bearer <supervisor token>`
- `x-rakazo-workspace-id`, `x-rakazo-bot-id`
- `x-rakazo-screen-id` (defaults to the acting bot)
- `x-rakazo-screen-lease-id` (`{runId}:{fence}`)

### Host / desktop execute

`DesktopSandboxProvider` (`packages/adapters/src/desktop-sandbox.ts`):

- Home under `DATA_DIR/desktop-computers/<homeKey>/`.
- `execute()` is `spawn(argv, { cwd, env: process.env })` as the API/worker user.
- `hostRoots: [homedir()]` when created via `createRunSandbox` — cwd may be anywhere under `$HOME`.
- `observe` / `act` / `sendInput` are placeholders (`graphical: false`, `takeover: false`).
- File ops stay inside the computer home via `realpath` + `allowedPath`.

## SPA affordances

Web + Electron share `apps/web/src/pages/Shell.tsx`. Route: `/app`, `/app/:botId`.

| Affordance | Behavior |
| --- | --- |
| Monitor icon (header) | Toggles `panel === "computer"` — live preview + Take control / Release |
| Preview iframe | Signed `/novnc/...` embed, `pointer-events: none` in the side panel |
| Open / Take control | `computer.boot` + `computer.takeover` when the user does not already hold the lease; opens full-window overlay |
| Overlay iframe | Interactive when `userHoldsComputerControl`; `view_only` otherwise |
| Release | `computer.release`; may resume a `waiting_takeover` run |
| Heartbeat | `computer.heartbeat` every 60s while the viewer is open |
| Desktop kind | Copy only: “runs on this computer, not a Linux desktop” — no iframe |
| Team vs Private | `ComputerModePicker` + `bots.setComputer` |
| Host choice | `HostComputerPrompt` (Electron, owner, `SANDBOX_PROVIDER=docker`, unset `computerHost`) |
| Teach | `TeachComputerSection` / `TeachCaptureOverlay` — user input via `computer.input` |
| Thread blocks | `block.kind === "computer"` for takeover prompts |

Screen URL path:

1. `rpc.computer.screenUrl` → `sandbox.connectScreen` + `addScreenProxyCapability` (`apps/api/src/screen-proxy.ts`).
2. Local Docker URLs become HMAC-signed `/novnc/{b64host}/{port}/{view\|control}/{exp}.{sig}/...` (1h TTL).
3. Vite / preview (`apps/web/src/screen-proxy.ts`, `apps/web/vite.config.ts`) proxy HTTP + WebSocket to the container port.
4. Policy: `view` forces `view_only=true`; `control` allows input. `withViewOnly` in `apps/web/src/lib/screen-url.ts`.

`computer.input` is refused unless the caller holds an active user control lease for that bot.

## Permissions, leases, and security

Two independent lease systems:

### User takeover lease (viewer)

DB on `Computer`: `controlHolder` (`none` \| `user` \| `bot`), `controlLeaseId`,
`controlLeaseExpiresAt`, `controlBotId`. Logic: `packages/adapters/src/computer-control.ts`.

- Default TTL 15 minutes (`COMPUTER_TAKEOVER_TTL_MS`).
- Expiry job `computer.control-expire` revokes interactive noVNC and emits `computer.takeover.released`.
- Human and agent input **coexist**. Takeover does not pause the run or lock the sandbox.
- `request_takeover` is the exception: the run pauses until the user releases.

Who can take control: any authenticated workspace member who can load the bot
(`repos.getBot(actor, botId)`). Takeover is refused if another run is active (except
`waiting_takeover`) — “Stop the bot first”.

### Team execution / screen lease (agent fencing)

`ComputerExecutionLease` unique on `(computerId, botId)`. Logic:
`packages/adapters/src/computer-lifecycle.ts`, `computer-screens.ts`.

- One computer-use run per bot on its own screen.
- `screenLeaseId` fences extra Xvfb ownership in the supervisor.
- If no display can be allocated: graphical tools return `MULTI_SCREEN_UNAVAILABLE`; shell and files still work.
- Private (`dedicated`) computers skip this lease.

### Docker / supervisor boundary

| Control | Detail |
| --- | --- |
| Docker socket | Supervisor only. Compose and docs treat this as host-equivalent power. |
| Supervisor auth | Single shared Bearer token, not per-user. |
| Container identity | Labels `rakazo.managed`, `rakazo.botId`, `rakazo.workspaceId` must match request headers. |
| Home path | Must be `DATA_DIR/homes/<homeKey>` (`assertBotHomePath`). Bind-mounted at `/home/rakazo`. |
| VNC | Passwordless, view-only by default, bound to loopback (or internal Compose network). Control stream is a separate port + token file. |
| noVNC in the browser | Short-lived signed `/novnc` capability. Do not replace with an open port proxy. |
| Team workspace | **Not a security boundary.** Every Team bot can read the full Team home. |

### Host / This Mac boundary

| Control | Detail |
| --- | --- |
| Who can enable | Deployment owner only, and only when `SANDBOX_PROVIDER=docker` (`canChooseHostComputer`). |
| OS permission | **None.** macOS does not show a TCC dialog. Consent is Rakazo’s one-time prompt. |
| Process identity | API/worker OS user, full `process.env`. |
| Reach | Shell cwd under `$HOME`. Documented as unsafe on a shared or public host. |

There is no connector/Composio approval on computer tools. Plugins are a separate path.

## Team vs Private

| | Team (default) | Private |
| --- | --- | --- |
| Scope | `team` / `team:{workspaceId}` | `dedicated` / `bot:{botId}` |
| Home key | `team-{workspaceId}` | `{botId}` |
| Layout | `bots/<bot-id>/` + `shared/` | Whole workspace is the bot home |
| Screens | Extra Xvfb stacks in one Docker machine (up to 8) | One machine / one screen |
| Persistence | `DATA_DIR/homes/<homeKey>` bind-mounted (Docker). Checkpoints at run end, stop, idle. | Same store, isolated key |

`packages/db/src/computers.ts`: `ensureComputerRecord`, `computerScopeKey`, `computerHomeKey`.

## Persistence (local)

Docker mounts the Rakazo-owned home directly. `LocalAgentHomeStore` keeps the latest
workspace under `DATA_DIR/homes/<homeKey>` and revision metadata under
`DATA_DIR/home-revisions`. Latest-only, not an immutable archive. The disposable OS image
is not portable: packages installed outside the workspace do not survive a provider move.

Idle: `SANDBOX_IDLE_MS` (default 10 minutes) → checkpoint + `sandbox.stop()`. Resume on
the next message or Take control.

## File pointers

### Contract and factory

| Path | Why it matters |
| --- | --- |
| `packages/adapter-kit/src/interfaces.ts` | `SandboxProvider` |
| `packages/adapter-kit/src/types.ts` | `ComputerAction`, `ComputerObservation`, job names |
| `packages/contracts/src/rpc.ts` | `computer.*`, `deployment.update.computerHost` |
| `packages/contracts/src/ids.ts` | `SandboxKind` |
| `packages/adapters/src/sandbox-factory.ts` | `createSandboxProvider` |
| `packages/adapters/src/host-aware-sandbox.ts` | Docker vs This Mac routing |

### Local backends

| Path | Why it matters |
| --- | --- |
| `packages/adapters/src/docker-sandbox.ts` | HTTP client to supervisor |
| `packages/adapters/src/desktop-sandbox.ts` | Host spawn / placeholder graphics |
| `infra/sandboxes/supervisor/src/index.ts` | Supervisor HTTP + dockerode |
| `infra/sandboxes/supervisor/src/supervisor-logic.ts` | Auth, screens, observe/act |
| `infra/sandboxes/supervisor/src/computer-spec.ts` | Image, ports, xdotool, `TEAM_SCREEN_LIMIT` |
| `infra/sandboxes/computer/Dockerfile` | Debian desktop image |
| `infra/sandboxes/computer/start.sh` | Primary Xvfb / noVNC stack |
| `infra/sandboxes/computer/embed.html` | noVNC embed (`view_only` query) |
| `infra/compose/docker-compose.yml` | Local Compose topology |

### Agent invocation

| Path | Why it matters |
| --- | --- |
| `packages/adapters/src/builtin-tools.ts` | Tool schemas the model sees |
| `packages/adapters/src/computer-tools.ts` | Action parse + screenshot tool results |
| `packages/adapters/src/pi-runtime.ts` | Pi registration, takeover, screenshot prune |
| `packages/adapters/src/executor.ts` | Run loop, `applyTool`, graphical filter |
| `packages/adapters/src/computer-lifecycle.ts` | Provision, execution leases |
| `packages/adapters/src/computer-control.ts` | Takeover lease |
| `packages/adapters/src/computer-screens.ts` | `MULTI_SCREEN_UNAVAILABLE` |
| `packages/adapters/src/computer-workspace.ts` | Checkpoint / restore / layout |
| `packages/adapters/src/computer-support.ts` | Path helpers, observations |
| `apps/api/src/router.ts` | `threads.send`, `computer.*`, `bots.setComputer` |
| `apps/api/src/app.ts` / `apps/worker/src/index.ts` | `createRunSandbox` + executor wiring |
| `apps/api/src/taught-skills.ts` | Teaching takeover |

### SPA and clients

| Path | Why it matters |
| --- | --- |
| `apps/web/src/pages/Shell.tsx` | Monitor icon, panel, overlay, Take control |
| `apps/web/src/pages/HostComputerPrompt.tsx` | Docker vs This Mac |
| `apps/web/src/lib/thread-events.ts` | `userHoldsComputerControl`, computer status reduce |
| `apps/web/src/lib/screen-url.ts` | Embed + iframe sandbox |
| `apps/api/src/screen-proxy.ts` | Signed `/novnc` capabilities |
| `apps/web/src/screen-proxy.ts` / `apps/web/vite.config.ts` | Dev/preview noVNC proxy |
| `apps/desktop/src/main.ts` / `preload.cjs` | Electron host; `rakazoDesktop.platform` |
| `apps/mobile/app/computer.tsx` / `apps/mobile/lib/computer.ts` | Native computer screen |

### Data and env

| Path | Why it matters |
| --- | --- |
| `packages/db/prisma/schema.prisma` | `Computer`, `ComputerExecutionLease` |
| `packages/db/src/computers.ts` | Team / Private records |
| `.env.example` | `SANDBOX_PROVIDER`, supervisor URL/token, idle/timeout |

### Tests that lock the local path

| Path | Why it matters |
| --- | --- |
| `packages/adapters/src/docker-sandbox.test.ts` | Supervisor HTTP mapping |
| `packages/adapters/src/host-aware-sandbox.test.ts` | This Mac routing |
| `packages/adapters/src/computer-control.test.ts` | Takeover expire/extend |
| `apps/web/e2e/team-computer.spec.ts` | SPA Team computer / takeover |
| `packages/testkit/src/journeys.test.ts` | Fake / desktop executor journeys |

`pnpm test:topology` is the local Docker + Graphile recovery smoke (needs Docker; not PR CI).
`pnpm test:computer` is a **live E2B + vision model** acceptance test — SaaS, not this map.

## What is stubbed or easy to over-copy

- `DockerSandboxProvider.snapshot()` returns a stub id; there is no `docker commit`.
- Desktop “graphics” are placeholders. Do not treat `SANDBOX_PROVIDER=desktop` as operate-the-host-GUI.
- Supervisor extra-screen registry is **in-memory** (lost on supervisor restart).
- `pty: true` is advertised; supervisor exec does not attach a TTY.
- Team folders are organizational, not isolation.
- Production Compose (`infra/compose/docker-compose.prod.yml`) uses E2B and **omits** the Docker supervisor — that file is SaaS/public-VM, not the local path.

## Notes for an adapter (open-swarm)

Proven local pattern worth copying:

1. **Split agent runtime from computer runtime.** Tools in the agent process; a `SandboxProvider`-shaped backend owns the machine.
2. **Default local graphical path = Docker desktop VM**, not “drive the user’s live GUI.” Xvfb + xdotool + noVNC + a signed viewer proxy.
3. **Keep the Docker socket off the API.** A small supervisor with a shared service token owns lifecycle.
4. **SPA computer icon** = status + signed embed + explicit Take control. Preview is view-only; control is a short lease. Do not make takeover an exclusive lock unless you need `request_takeover`-style protected input.
5. **No per-click approval** on agent `computer_act`. Approval sits at host-choice (This Mac) and at takeover / teach.
6. **Team multi-screen** = extra displays in one machine + a per-bot execution lease, not a global computer mutex.
7. **Host/bare-metal** as an explicit, owner-only, shell-only escape hatch — not the primary operate design.

Drop or defer if you do not need them: teaching-skill recording, Composio/MCP plugins, SaaS providers, Electron This Mac prompt, mobile WebView.

SaaS computer providers remain deferred per REQ-189.
