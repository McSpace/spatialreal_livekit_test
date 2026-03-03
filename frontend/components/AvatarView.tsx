'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AvatarSDK,
  AvatarManager,
  AvatarView as AvatarViewInstance,
  Environment,
  DrivingServiceMode,
} from '@spatialwalk/avatarkit'
import { AvatarPlayer, LiveKitProvider } from '@spatialwalk/avatarkit-rtc'

interface AvatarViewProps {
  livekitUrl: string
  avatarToken: string
  roomName: string
  width?: number
  height?: number
}

export function AvatarView({
  livekitUrl,
  avatarToken,
  roomName,
  width = 480,
  height = 480,
}: AvatarViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<AvatarPlayer | null>(null)
  const viewRef = useRef<AvatarViewInstance | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    // Local vars so cleanup only affects THIS effect's instances,
    // not a newer effect's instances (React Strict Mode runs effects twice in dev).
    let localPlayer: AvatarPlayer | null = null
    let localView: AvatarViewInstance | null = null

    async function init() {
      try {
        if (!AvatarSDK.isInitialized) {
          await AvatarSDK.initialize(
            process.env.NEXT_PUBLIC_SPATIALREAL_APP_ID!,
            {
              environment: Environment.intl,
              drivingServiceMode: DrivingServiceMode.host,
            }
          )
        }

        if (cancelled) return

        const avatarId = process.env.NEXT_PUBLIC_SPATIALREAL_AVATAR_ID!
        const avatar = await AvatarManager.shared.load(avatarId)
        if (!avatar || cancelled) return
        if (!containerRef.current) return

        const avatarView = new AvatarViewInstance(avatar, containerRef.current)
        localView = avatarView
        viewRef.current = avatarView
        avatarView.onFirstRendering = () => setStatus('ready')

        if (cancelled) {
          avatarView.dispose()
          return
        }

        const provider = new LiveKitProvider()
        const player = new AvatarPlayer(provider, avatarView, {
          logLevel: 'warning',
          enableJitterBuffer: false, // disable buffering to avoid "starved" stalls
        })
        localPlayer = player
        playerRef.current = player

        player.on('error', (err) => {
          console.error('[AvatarPlayer] error:', err)
          setStatus('error')
        })
        player.on('stalled', () => {
          player.reconnect()
        })

        if (cancelled) {
          player.disconnect()
          return
        }

        await player.connect({ url: livekitUrl, token: avatarToken, roomName })

        // LiveKitProvider auto-plays audio from ALL remote participants, including
        // the user's microphone track → causes echo. Fix: immediately unsubscribe
        // avatar-viewer from every participant that is NOT spatialreal-avatar.
        const room = player.getNativeClient() as any
        if (room) {
          const unsubscribeNonAvatar = (participant: any) => {
            if (participant.identity === 'spatialreal-avatar') return
            participant.trackPublications.forEach((pub: any) => {
              if (pub.kind === 'audio') pub.setSubscribed(false)
            })
          }
          // Existing participants.
          for (const p of room.remoteParticipants.values()) unsubscribeNonAvatar(p)
          // Future participants (e.g. agent joins after us).
          room.on('trackSubscribed', (_track: unknown, _pub: unknown, participant: unknown) => {
            unsubscribeNonAvatar(participant)
          })
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[AvatarView] init failed:', err)
          setStatus('error')
        }
      }
    }

    init()

    return () => {
      cancelled = true
      // Disconnect/dispose only the instances created by THIS effect invocation.
      localPlayer?.disconnect()
      localView?.dispose()
      playerRef.current = null
      viewRef.current = null
    }
  }, [livekitUrl, avatarToken, roomName])

  return (
    <div style={{ position: 'relative', width, height }}>
      {/* Container must have explicit width/height — required by AvatarKit */}
      <div ref={containerRef} style={{ width, height }} />
      {status === 'loading' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
            fontSize: 14,
          }}
        >
          Loading avatar…
        </div>
      )}
      {status === 'error' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#f87171',
            fontSize: 14,
          }}
        >
          Avatar unavailable
        </div>
      )}
    </div>
  )
}
