'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ControlBar,
  useVoiceAssistant,
  BarVisualizer,
} from '@livekit/components-react'
import { AvatarView } from './AvatarView'

interface SessionData {
  userToken: string
  avatarToken?: string
  url: string
  roomName: string
  avatarEnabled: boolean
}

export function VoiceAgent() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Whether backend supports avatar at all (fetched once on mount).
  const [avatarSupported, setAvatarSupported] = useState(false)
  // User preference for this session.
  const [useAvatar, setUseAvatar] = useState(true)

  useEffect(() => {
    fetch('/api/token')
      .then((r) => r.json())
      .then((data) => {
        setAvatarSupported(data.avatarEnabled ?? false)
      })
      .catch(() => {/* silently ignore — checkbox stays hidden */})
  }, [])

  const startSession = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const roomName = `room-${Date.now()}`
      const participantIdentity = `user-${Math.random().toString(36).slice(2, 8)}`

      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, participantIdentity, useAvatar }),
      })

      if (!res.ok) throw new Error(`Token request failed: ${res.status}`)
      const data = await res.json()
      setSession(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session')
    } finally {
      setLoading(false)
    }
  }, [useAvatar])

  const endSession = useCallback(() => setSession(null), [])

  if (!session) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 16,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>SpatialReal Voice Agent</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <button
            onClick={startSession}
            disabled={loading}
            style={{
              padding: '12px 32px',
              fontSize: 16,
              borderRadius: 8,
              border: 'none',
              background: '#6366f1',
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Connecting…' : 'Start conversation'}
          </button>

          {avatarSupported && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#e5e7eb', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={useAvatar}
                onChange={(e) => setUseAvatar(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              Render avatar
            </label>
          )}
        </div>

        {error && <p style={{ color: '#f87171', fontSize: 14 }}>{error}</p>}
      </div>
    )
  }

  return (
    <LiveKitRoom
      token={session.userToken}
      serverUrl={session.url}
      audio={true}
      video={false}
      connect={true}
      onDisconnected={endSession}
      onError={(err) => setError(err.message)}
      data-lk-theme="default"
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <RoomContent
        livekitUrl={session.url}
        avatarToken={session.avatarToken}
        roomName={session.roomName}
        avatarEnabled={session.avatarEnabled}
      />

      {/* Mute when avatar is active: AvatarPlayer's own WebRTC connection plays
          spatialreal-avatar audio. Without avatar, the agent publishes audio
          directly as a normal LiveKit track — let RoomAudioRenderer play it. */}
      <RoomAudioRenderer muted={session.avatarEnabled} />

      <ControlBar
        controls={{ microphone: true, camera: false, screenShare: false, leave: true }}
      />
    </LiveKitRoom>
  )
}

function RoomContent({
  livekitUrl,
  avatarToken,
  roomName,
  avatarEnabled,
}: {
  livekitUrl: string
  avatarToken?: string
  roomName: string
  avatarEnabled: boolean
}) {
  const { state, audioTrack } = useVoiceAssistant()

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 24,
      }}
    >
      {avatarEnabled && avatarToken && (
        <AvatarView
          livekitUrl={livekitUrl}
          avatarToken={avatarToken}
          roomName={roomName}
          width={400}
          height={400}
        />
      )}

      {audioTrack && (
        <BarVisualizer
          state={state}
          trackRef={audioTrack}
          barCount={7}
          style={{ width: 280, height: 48 }}
        />
      )}

      <p style={{ color: '#9ca3af', fontSize: 13 }}>
        Agent is <strong style={{ color: '#e5e7eb' }}>{state}</strong>
      </p>
    </div>
  )
}
