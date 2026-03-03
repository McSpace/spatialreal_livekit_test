import json
import logging
import os
import time
from dotenv import load_dotenv

from livekit.agents import AgentSession, Agent, JobContext, JobProcess, WorkerOptions, cli
from livekit.plugins import openai, silero, deepgram, cartesia, spatialreal
from livekit.plugins.turn_detector.multilingual import MultilingualModel

load_dotenv()

# Fallback: use ENABLE_AVATAR env var if not overridden per-session via job metadata.
_AVATAR_ENABLED_DEFAULT = os.getenv("ENABLE_AVATAR", "true").lower() == "true"

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("spatialreal-agent")


def prewarm(proc: JobProcess) -> None:
    """Runs once per worker process before any job is accepted.
    Pre-loads the Silero VAD model so the first job doesn't pay the
    ONNX cold-start penalty.

    force_cpu=False → ONNX Runtime picks CoreMLExecutionProvider on Apple Silicon
    (listed first in onnxruntime.get_available_providers()), which runs on the
    Neural Engine and is ~10-50x faster than the single-threaded CPU provider.
    """
    logger.info("[PREWARM] loading Silero VAD model (force_cpu=False → CoreML)...")
    proc.userdata["vad"] = silero.VAD.load(force_cpu=False)
    logger.info("[PREWARM] Silero VAD ready")


class Assistant(Agent):
    def __init__(self):
        super().__init__(
            instructions=(
                "You are a helpful voice assistant with an avatar. "
                "Keep your responses concise and conversational."
            ),
        )


def _attach_pipeline_logging(session: AgentSession) -> None:
    """Attach event listeners that log every stage of the VAD→STT→LLM→TTS pipeline
    with wall-clock timestamps so latency bottlenecks are easy to spot."""

    _t: dict[str, float] = {}  # named checkpoints

    def _ts(label: str) -> float:
        t = time.monotonic()
        _t[label] = t
        return t

    def _delta(from_label: str) -> str:
        if from_label not in _t:
            return "?"
        return f"{(time.monotonic() - _t[from_label]) * 1000:.0f}ms"

    @session.on("user_state_changed")
    def on_user_state(ev):  # type: ignore[misc]
        old, new = ev.old_state, ev.new_state
        if new == "speaking":
            _ts("user_speech_start")
            logger.info("[PIPELINE] 🎤 user started speaking")
        elif new == "listening" and old == "speaking":
            logger.info(
                "[PIPELINE] 🔇 user stopped speaking  (speech duration ~%s)",
                _delta("user_speech_start"),
            )
            _ts("user_speech_end")
        elif new == "away":
            logger.info("[PIPELINE] user state → away")

    @session.on("user_input_transcribed")
    def on_transcript(ev):  # type: ignore[misc]
        if not ev.is_final:
            logger.debug("[PIPELINE] 📝 STT interim: %r", ev.transcript[:80])
            return
        logger.info(
            "[PIPELINE] ✅ STT final: %r  (since speech_end: %s)",
            ev.transcript[:120],
            _delta("user_speech_end"),
        )
        _ts("stt_final")

    @session.on("agent_state_changed")
    def on_agent_state(ev):  # type: ignore[misc]
        old, new = ev.old_state, ev.new_state
        if new == "thinking":
            logger.info(
                "[PIPELINE] 🤔 LLM thinking  (since stt_final: %s)",
                _delta("stt_final"),
            )
            _ts("llm_start")
        elif new == "speaking":
            logger.info(
                "[PIPELINE] 🔊 agent speaking / TTS first audio  "
                "(since llm_start: %s | total since user stopped: %s)",
                _delta("llm_start"),
                _delta("user_speech_end"),
            )
            _ts("agent_speaking_start")
        elif new == "listening" and old == "speaking":
            logger.info(
                "[PIPELINE] ✔ agent finished speaking  (duration: %s)",
                _delta("agent_speaking_start"),
            )
        else:
            logger.debug("[PIPELINE] agent state: %s → %s", old, new)

    @session.on("conversation_item_added")
    def on_item_added(ev):  # type: ignore[misc]
        msg = ev.item
        role = getattr(msg, "role", "?")
        content = getattr(msg, "text_content", None) or str(getattr(msg, "content", ""))
        logger.info("[PIPELINE] 💬 conversation_item_added  role=%s  %r", role, str(content)[:120])


async def entrypoint(ctx: JobContext):
    logger.info(">>> [1] entrypoint called, job_id=%s room=%s", ctx.job.id, ctx.job.room.name)

    # Per-session avatar flag can be overridden via dispatch metadata.
    job_meta: dict = {}
    if ctx.job.metadata:
        try:
            job_meta = json.loads(ctx.job.metadata)
        except Exception:
            pass
    enable_avatar = job_meta.get("enableAvatar", _AVATAR_ENABLED_DEFAULT)
    logger.info(">>> [1b] enable_avatar=%s", enable_avatar)

    await ctx.connect()
    logger.info(">>> [2] ctx.connect() done — participants: %s",
                list(ctx.room.remote_participants.keys()))

    session = AgentSession(
        vad=ctx.proc.userdata["vad"],
        stt=deepgram.STT(
            model="nova-3",
            interim_results=True,
            language="multi", 
            punctuate=True,
            # 300ms: 100ms was too aggressive for Russian speech — natural pauses
            # between clause fragments (e.g. mid-riddle) caused premature commits.
            endpointing_ms=300,
            no_delay=True,
        ),
        llm=openai.LLM(model="gpt-5-nano"),
        # sample_rate=16000 matches SpatialReal's default AvatarKit session config.
        # Cartesia defaults to 24000 Hz which causes 1.5× slowdown via SpatialReal.
        tts=cartesia.TTS(
            model="sonic-2",
            #language="ru",
            #voice="da05e96d-ca10-4220-9042-d8acef654fa9",
            voice="42b39f37-515f-4eee-8546-73e841679c1d",
            sample_rate=16000
            ),
        # MultilingualModel predicts end-of-turn semantically (local LLM), so it
        # doesn't cut speech mid-sentence and doesn't wait unnecessarily long.
        turn_detection=MultilingualModel(),
        min_endpointing_delay=0.5,
        max_endpointing_delay=5.0,
        false_interruption_timeout=1.0,
    )
    logger.info(">>> [3] AgentSession created")
    logger.info(
        ">>> [3b] pipeline: VAD=Silero  STT=%s  LLM=%s  TTS=%s  TurnDetect=MultilingualModel",
        session.stt.__class__.__name__,
        session.llm.__class__.__name__,
        session.tts.__class__.__name__,
    )

    _attach_pipeline_logging(session)

    if enable_avatar:
        # SpatialReal plugin intercepts TTS audio and drives the avatar.
        # It publishes animation + synced audio back into the LiveKit room.
        avatar = spatialreal.AvatarSession()
        logger.info(">>> [4] AvatarSession created, starting...")
        try:
            await avatar.start(session, room=ctx.room)
            logger.info(">>> [5] AvatarSession started")
        except ConnectionError as e:
            # HTTP 402 = SpatialReal quota/credits exhausted.
            # Any other connection failure falls here too.
            # Log and continue — agent runs without avatar.
            logger.warning(
                ">>> [5] AvatarSession failed to start (%s) — continuing without avatar", e
            )
            # Tell the frontend to switch to audio-only mode so RoomAudioRenderer
            # unmutes and the user can hear the agent's TTS directly.
            await ctx.room.local_participant.publish_data(
                json.dumps({"type": "avatarFailed"}).encode(),
                reliable=True,
            )
    else:
        logger.info(">>> [4-5] Avatar disabled — skipping AvatarSession")

    await session.start(agent=Assistant(), room=ctx.room)
    logger.info(">>> [6] AgentSession started, sending greeting...")

    await session.say("Hello! Welcome on board")
    logger.info(">>> [7] greeting sent")


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="spatialreal-assistant",
        )
    )
