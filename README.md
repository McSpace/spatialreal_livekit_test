# SpatialReal Voice Agent

## Background

The team at SpatialReal reached out asking me to test their real-time avatar engine. I had published a few pet projects involving voice chat interfaces, so apparently I was on their radar. Since I had been thinking about adding an avatar feature to some of those projects anyway, I agreed.

When I opened their docs I was happy to find a LiveKit integration example — LiveKit is my preferred engine for this kind of work. I do most of my development through Claude Code, so I started by having it read through the entire SpatialReal documentation and walk me through the SDK architecture and its operating modes. Then I asked it to create the necessary Claude Code skills for the frontend and agent sides of the integration, alongside the LiveKit skills it already had.

After that I described, in plain language, the test project I wanted: a LiveKit Agent with Deepgram STT and Cartesia TTS connected to a SpatialReal avatar. Claude Code produced a detailed implementation plan — entirely predictable, the only thing I adjusted was swapping `pip` for `uv` and `npm` for `pnpm`. While the code was being generated I went through the admin panels for each service and created the required API keys and configuration. What followed was a short cycle of fixes and refinements, the main challenges being an echo in the microphone and the avatar slowing down the generated speech by 2×. Both were resolved — see [integration_report.md](./integration_report.md) for the full breakdown — and the result matched what I had in mind from the start.

---

## Stack

- **Agent**: Python · livekit-agents · Deepgram STT · OpenAI GPT-4o mini · Cartesia TTS · livekit-plugins-spatialreal
- **Frontend**: Next.js · @livekit/components-react · @spatialwalk/avatarkit-rtc

---

## Prerequisites

- Python 3.10+, [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Node.js 18+, [pnpm](https://pnpm.io/installation)
- [LiveKit server](https://docs.livekit.io/home/self-hosting/local/) (local dev) or LiveKit Cloud

---

## Setup

### 1. LiveKit server (local)

```bash
brew install livekit
livekit-server --dev
```

### 2. Agent

```bash
cd agent
cp .env.example .env
# Fill in your API keys in .env
uv sync
uv run python agent.py dev
```

### 3. Frontend

```bash
cd frontend
cp .env.local.example .env.local
# Fill in your values in .env.local
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Start conversation**.

The start screen shows a **Render avatar** checkbox (visible when `ENABLE_AVATAR=true` is set in both env files). Uncheck it to run the agent with audio only — useful for isolating issues.

---

## Environment Variables

### agent/.env

| Variable | Description |
|----------|-------------|
| `LIVEKIT_URL` | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `SPATIALREAL_API_KEY` | SpatialReal API key (from dash.spatialreal.ai) |
| `SPATIALREAL_APP_ID` | SpatialReal App ID |
| `SPATIALREAL_AVATAR_ID` | Avatar ID from SpatialReal Studio |
| `DEEPGRAM_API_KEY` | Deepgram API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `CARTESIA_API_KEY` | Cartesia API key |
| `ENABLE_AVATAR` | `true` / `false` — enables SpatialReal avatar session |

### frontend/.env.local

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_LIVEKIT_URL` | LiveKit server URL (used in browser) |
| `LIVEKIT_API_KEY` | LiveKit API key (server-side only) |
| `LIVEKIT_API_SECRET` | LiveKit API secret (server-side only) |
| `NEXT_PUBLIC_SPATIALREAL_APP_ID` | SpatialReal App ID (used in browser) |
| `NEXT_PUBLIC_SPATIALREAL_AVATAR_ID` | Avatar ID (used in browser) |
| `ENABLE_AVATAR` | `true` / `false` — must match agent setting |

---

## Architecture

```
Browser (Next.js)
  │
  ├─ LiveKitRoom (user mic + agent audio)
  │    └─ @livekit/components-react
  │
  └─ AvatarView (SpatialReal avatar rendering)          ← only when ENABLE_AVATAR=true
       └─ @spatialwalk/avatarkit-rtc
            connects as a separate subscriber to the same LiveKit room

LiveKit Server (room)
  │
Python Agent
  ├─ Deepgram STT → OpenAI LLM → Cartesia TTS
  └─ livekit-plugins-spatialreal                        ← only when ENABLE_AVATAR=true
       intercepts TTS audio → SpatialReal servers
       → publishes animation + audio tracks back into room
```

---

## SpatialReal Studio

1. Create an app at https://dash.spatialreal.ai/apps
2. Generate API key (shown only once — save it immediately)
3. Get Avatar ID from Studio → Avatars

---

## Integration Notes

For a detailed account of every non-obvious issue encountered during integration and how each was resolved, see **[integration_report.md](./integration_report.md)**.
