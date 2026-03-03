# SpatialReal Avatar + LiveKit Integration: Issues & Fixes

A report of every non-obvious problem encountered while integrating the SpatialReal real-time avatar engine into a LiveKit voice agent application (Python backend + Next.js frontend).

---

## 1. Wrong `AvatarPlayer` Constructor Argument Order

**Symptom:** `TypeError: this.provider.on is not a function`

**Cause:** Arguments were passed in the wrong order.

```ts
// Wrong
new AvatarPlayer(avatarView, provider)

// Correct
new AvatarPlayer(provider, avatarView, options)
```

**Note:** The published docs showed the wrong order at the time. Confirmed by inspecting `node_modules`.

---

## 2. Wrong `player.connect()` Signature

**Symptom:** Connection failed silently or threw an error.

**Cause:** `connect()` takes a single config object, not three positional arguments.

```ts
// Wrong
await player.connect(url, token, roomName)

// Correct
await player.connect({ url, token, roomName })
```

---

## 3. React Strict Mode Double-Mount Causing Premature Disconnect

**Symptom:** Browser console showed `connected → disconnected` immediately on mount. Avatar never rendered.

**Cause:** React Strict Mode runs `useEffect` twice in development. The cleanup function of the first run called `playerRef.current?.disconnect()`, which disconnected the second run's player (because refs are shared across invocations).

**Fix:** Use local closure variables (`let localPlayer`, `let localView`) instead of refs for cleanup. Add `if (cancelled) return` guards throughout the async `init()` function.

---

## 4. LiveKit Agent Dispatch Never Triggered

**Symptom:** Agent registered successfully (`spatialreal-assistant` appeared in the worker), but `entrypoint` was never called when the user joined a room.

**Cause:** Wrong mechanism for dispatching agents. We were setting `at.metadata` with a JSON string, which is participant metadata — not a room agent dispatch configuration.

```ts
// Wrong — this is participant metadata, not agent dispatch
at.metadata = JSON.stringify({ roomAgentDispatch: [...] })

// Correct — protobuf field on AccessToken
at.roomConfig = new RoomConfiguration({
  agents: [new RoomAgentDispatch({ agentName: 'spatialreal-assistant' })]
})
```

---

## 5. Double Audio Playback (Echo + Distortion)

**Symptom:** Agent voice sounded doubled or distorted when avatar was enabled.

**Cause:** Two WebRTC connections were both subscribing to the `spatialreal-avatar` participant's audio track:
- The **main user connection** via `<RoomAudioRenderer />`
- The **avatar-viewer connection** via `AvatarPlayer`'s internal `LiveKitProvider`

**Fix:** Set `<RoomAudioRenderer muted />` so only `AvatarPlayer` handles avatar audio.

---

## 6. Animation Jitter Buffer Stalls

**Symptom:** Console warnings: `[RTC][AnimationHandler] Jitter buffer: starved`. Avatar animation stuttered.

**Cause:** The default jitter buffer waited for in-order frames at 25 fps, but network jitter caused starvation under normal conditions.

**Fix:**
```ts
new AvatarPlayer(provider, avatarView, { enableJitterBuffer: false })
```

---

## 7. Avatar-Viewer Plays User's Own Microphone Back (Echo)

**Symptom:** User heard their own voice echoed while speaking.

**Cause:** `LiveKitProvider` inside `AvatarPlayer` auto-attaches an `<audio>` element for **every** remote audio track in the room — including the user's microphone track (which is remote from `avatar-viewer`'s perspective).

**Fix:** After `player.connect()`, use `getNativeClient()` to access the underlying LiveKit Room and immediately unsubscribe `avatar-viewer` from all non-`spatialreal-avatar` audio tracks:

```ts
const room = player.getNativeClient() as any
for (const p of room.remoteParticipants.values()) {
  if (p.identity !== 'spatialreal-avatar') {
    p.trackPublications.forEach((pub: any) => {
      if (pub.kind === 'audio') pub.setSubscribed(false)
    })
  }
}
room.on('trackSubscribed', (_t: unknown, _p: unknown, participant: unknown) => {
  // same filter applied to future participants
})
```

---

## 8. Agent Voice 1.5× Slower Than Normal

**Symptom:** Avatar spoke noticeably slowly; voice pitch was lowered.

**Cause:** Sample rate mismatch across three layers:

| Layer | Sample rate |
|-------|-------------|
| `avatarkit` `SessionConfig` default | **16000 Hz** |
| `livekit-plugins-spatialreal` → `new_avatar_session()` | no `sample_rate` passed → uses default **16000 Hz** |
| Cartesia TTS default output | **24000 Hz** |

SpatialReal received 24000-sample-per-second audio, interpreted it as 16000 Hz, and published it back to the LiveKit room at that rate. Result: 24000 / 16000 = **1.5× slower playback** with a lowered pitch.

**Fix:**
```python
tts=cartesia.TTS(sample_rate=16000)  # match SpatialReal's AvatarKit default
```

---

---

## 9. High STT Latency + Speech "Swallowed" (Silero VAD Backlog)

**Symptom:** STT final transcript arrived 3-7 seconds after the user finished speaking. Transcripts were sometimes garbled or truncated ("Could you you're"). Multiple `user_state_changed` cycles (start/stop/start) appeared for a single utterance.

**Cause:** Silero VAD processes audio through ONNX Runtime in its own queue. Even with CoreML acceleration on Apple Silicon, this queue can build up under load, delaying the audio that Deepgram receives. Additionally, Silero's default silence threshold occasionally cuts speech mid-sentence, sending Deepgram fragmented audio.

**Fix:** Add `turn_detection=MultilingualModel()` to `AgentSession` and set `endpointing_ms=100` in Deepgram STT:

```python
from livekit.plugins.turn_detector.multilingual import MultilingualModel

session = AgentSession(
    vad=ctx.proc.userdata["vad"],
    stt=deepgram.STT(model="nova-3", interim_results=True, endpointing_ms=100, no_delay=True),
    turn_detection=MultilingualModel(),  # semantic end-of-turn prediction
    min_endpointing_delay=0.5,
    max_endpointing_delay=5.0,
    ...
)
```

`MultilingualModel` is a small local LLM (bundled in `livekit-agents[turn-detector]`) that predicts whether the user has finished their turn based on transcript semantics, not just silence duration. It prevents false-positive cuts when the user pauses mid-sentence, and doesn't wait unnecessarily long when the turn is clearly complete.

---

## Summary Table

| # | Symptom | Root Cause | Fix |
|---|---------|-----------|-----|
| 1 | `provider.on is not a function` | Wrong constructor arg order | `new AvatarPlayer(provider, view, opts)` |
| 2 | Connection fails | `connect()` takes a config object | `player.connect({ url, token, roomName })` |
| 3 | `connected → disconnected` immediately | React Strict Mode double-mount + shared refs | Local closure vars + `cancelled` guards |
| 4 | Agent entrypoint never called | Wrong agent dispatch API | `at.roomConfig = new RoomConfiguration(...)` |
| 5 | Double/distorted audio | Two connections playing the same track | `<RoomAudioRenderer muted />` |
| 6 | Avatar animation stutters | Jitter buffer starvation | `enableJitterBuffer: false` |
| 7 | User hears own voice echoed | `LiveKitProvider` auto-plays all audio tracks | Unsubscribe `avatar-viewer` from non-avatar audio |
| 8 | Voice 1.5× too slow | Cartesia 24 kHz → SpatialReal expects 16 kHz | `cartesia.TTS(sample_rate=16000)` |
| 9 | STT 3-7s delay + garbled transcripts | Silero VAD audio backlog + false cuts mid-sentence | `turn_detection=MultilingualModel()` + `endpointing_ms=100` |
