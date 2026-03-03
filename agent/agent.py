import json
import logging
import os
from dotenv import load_dotenv

from livekit.agents import AgentSession, Agent, JobContext, WorkerOptions, cli
from livekit.plugins import openai, silero, deepgram, cartesia, spatialreal

load_dotenv()

# Fallback: use ENABLE_AVATAR env var if not overridden per-session via job metadata.
_AVATAR_ENABLED_DEFAULT = os.getenv("ENABLE_AVATAR", "true").lower() == "true"

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("spatialreal-agent")


class Assistant(Agent):
    def __init__(self):
        super().__init__(
            instructions=(
                "You are a helpful voice assistant with an avatar. "
                "Keep your responses concise and conversational."
            ),
        )


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
        vad=silero.VAD.load(),
        stt=deepgram.STT(model="nova-3"),
        llm=openai.LLM(model="gpt-4o-mini"),
        # sample_rate=16000 matches SpatialReal's default AvatarKit session config.
        # Cartesia defaults to 24000 Hz which causes 1.5× slowdown via SpatialReal.
        tts=cartesia.TTS(sample_rate=16000),
    )
    logger.info(">>> [3] AgentSession created")

    if enable_avatar:
        # SpatialReal plugin intercepts TTS audio and drives the avatar.
        # It publishes animation + synced audio back into the LiveKit room.
        avatar = spatialreal.AvatarSession()
        logger.info(">>> [4] AvatarSession created, starting...")
        await avatar.start(session, room=ctx.room)
        logger.info(">>> [5] AvatarSession started")
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
            agent_name="spatialreal-assistant",
        )
    )
