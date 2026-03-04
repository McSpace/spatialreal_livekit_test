'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useVoiceAssistant,
  BarVisualizer,
  useRoomContext,
  useLocalParticipant,
} from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { AvatarView } from './AvatarView'

interface SessionData {
  userToken: string
  avatarToken?: string
  url: string
  roomName: string
  avatarEnabled: boolean
}

function useWindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return size
}

export function VoiceAgent() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [avatarSupported, setAvatarSupported] = useState(false)
  const [useAvatar, setUseAvatar] = useState(true)
  const [avatarActive, setAvatarActive] = useState(false)

  useEffect(() => {
    fetch('/api/token')
      .then((r) => r.json())
      .then((data) => setAvatarSupported(data.avatarEnabled ?? false))
      .catch(() => {})
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
      setAvatarActive(data.avatarEnabled)
      setSession(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session')
    } finally {
      setLoading(false)
    }
  }, [useAvatar])

  const endSession = useCallback(() => {
    setSession(null)
    setAvatarActive(false)
  }, [])

  if (!session) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(135deg, #0a0a12 0%, #12121f 50%, #0a0a12 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 24,
          padding: '48px 56px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 28,
          minWidth: 320,
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
            SpatialReal Voice Agent
          </h1>

          {avatarSupported && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: '#94a3b8', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={useAvatar}
                onChange={(e) => setUseAvatar(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#6366f1' }}
              />
              Render avatar
            </label>
          )}

          <button
            onClick={startSession}
            disabled={loading}
            style={{
              padding: '13px 40px',
              fontSize: 15,
              fontWeight: 500,
              borderRadius: 12,
              border: '1px solid rgba(99, 102, 241, 0.5)',
              background: loading ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.8)',
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              letterSpacing: '0.01em',
            }}
          >
            {loading ? 'Connecting…' : 'Start conversation'}
          </button>

          {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
        </div>
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
      style={{ position: 'fixed', inset: 0 }}
    >
      <RoomContent
        livekitUrl={session.url}
        avatarToken={session.avatarToken}
        roomName={session.roomName}
        avatarActive={avatarActive}
        onAvatarFailed={() => setAvatarActive(false)}
      />
      <RoomAudioRenderer muted={avatarActive} />
    </LiveKitRoom>
  )
}

function RoomContent({
  livekitUrl,
  avatarToken,
  roomName,
  avatarActive,
  onAvatarFailed,
}: {
  livekitUrl: string
  avatarToken?: string
  roomName: string
  avatarActive: boolean
  onAvatarFailed: () => void
}) {
  const { state, audioTrack } = useVoiceAssistant()
  const room = useRoomContext()
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()
  const { width, height } = useWindowSize()

  useEffect(() => {
    const handleData = (payload: Uint8Array) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload))
        if (msg.type === 'avatarFailed') onAvatarFailed()
      } catch {}
    }
    room.on(RoomEvent.DataReceived, handleData)
    return () => { room.off(RoomEvent.DataReceived, handleData) }
  }, [room, onAvatarFailed])

  return (
    <>
      {/* ── Background layer ─────────────────────────────── */}
      <div style={{ position: 'fixed', inset: 0, background: '#050508' }}>
        {avatarActive && avatarToken && width > 0 && (
          <AvatarView
            livekitUrl={livekitUrl}
            avatarToken={avatarToken}
            roomName={roomName}
            width={width}
            height={height}
          />
        )}
        {!avatarActive && (
          /* Subtle gradient background when no avatar */
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(99,102,241,0.08) 0%, transparent 70%)',
          }} />
        )}
      </div>

      {/* ── Bottom controls overlay ───────────────────────── */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '20px 32px 28px',
        backdropFilter: 'blur(24px) saturate(160%)',
        WebkitBackdropFilter: 'blur(24px) saturate(160%)',
        background: 'rgba(5, 5, 10, 0.55)',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
      }}>
        {audioTrack && (
          <BarVisualizer
            state={state}
            trackRef={audioTrack}
            barCount={7}
            style={{ width: 180, height: 36 }}
          />
        )}

        <p style={{ color: '#64748b', fontSize: 13, margin: 0, minWidth: 110, textAlign: 'center' }}>
          Agent is <strong style={{ color: '#e2e8f0' }}>{state}</strong>
        </p>

        {avatarToken && !avatarActive && (
          <span style={{
            fontSize: 11,
            color: '#94a3b8',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            padding: '3px 8px',
            letterSpacing: '0.03em',
          }}>
            Audio only
          </span>
        )}

        {/* Mic toggle */}
        <button
          onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          title={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.12)',
            background: isMicrophoneEnabled ? 'rgba(99,102,241,0.25)' : 'rgba(239,68,68,0.25)',
            color: isMicrophoneEnabled ? '#a5b4fc' : '#fca5a5',
            fontSize: 18,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
        >
          {isMicrophoneEnabled ? '🎤' : '🔇'}
        </button>

        {/* Leave */}
        <button
          onClick={() => room.disconnect()}
          title="Leave"
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(239,68,68,0.2)',
            color: '#fca5a5',
            fontSize: 16,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
    </>
  )
}
