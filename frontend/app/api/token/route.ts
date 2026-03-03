import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk'
import { NextRequest, NextResponse } from 'next/server'

const avatarEnabledOnServer = process.env.ENABLE_AVATAR === 'true'

// Return server-side avatar capability so the UI can show/hide the checkbox
// before the session starts.
export async function GET() {
  return NextResponse.json({ avatarEnabled: avatarEnabledOnServer })
}

export async function POST(req: NextRequest) {
  const { roomName, participantIdentity, useAvatar } = await req.json()

  if (!roomName || !participantIdentity) {
    return NextResponse.json(
      { error: 'roomName and participantIdentity are required' },
      { status: 400 }
    )
  }

  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set' },
      { status: 500 }
    )
  }

  // Effective avatar state for this session: backend must support it AND user wants it.
  const avatarEnabled = avatarEnabledOnServer && (useAvatar !== false)

  // User token — publishes microphone, subscribes to agent audio + avatar tracks
  const userAt = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    name: participantIdentity,
  })
  userAt.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  })
  // Dispatch the agent. Pass enableAvatar so the agent can conditionally start
  // spatialreal.AvatarSession() for this specific session.
  userAt.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: 'spatialreal-assistant',
        metadata: JSON.stringify({ participantIdentity, enableAvatar: avatarEnabled }),
      }),
    ],
  })

  const tokens: { userToken: string; avatarToken?: string } = {
    userToken: await userAt.toJwt(),
  }

  if (avatarEnabled) {
    // Avatar viewer token — separate identity for AvatarPlayer's own WebRTC connection.
    const avatarAt = new AccessToken(apiKey, apiSecret, {
      identity: `avatar-viewer-${participantIdentity}`,
    })
    avatarAt.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: false,
      canSubscribe: true,
    })
    tokens.avatarToken = await avatarAt.toJwt()
  }

  return NextResponse.json(
    {
      ...tokens,
      url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
      roomName,
      avatarEnabled,
    },
    { status: 201 }
  )
}
