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

const AVATAR_BG =
  'https://cdn.spatialwalk.cloud/character-resource-bj/assets/2026-02-09/73c1e543-d425-4062-b9ff-9f7a517a56f4.jpg?imageView2/2/w/1920/q/80/format/webp'

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

        player.on('error', (err: unknown) => {
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
      playerRef.current = null
      viewRef.current = null
      // disconnect() schedules async LiveKit room events (Promise chain). If we
      // call dispose() synchronously right after, those events fire later and
      // AvatarKit tries to render an idle frame on an already-disposed view →
      // "AvatarView not initialized". Delaying dispose() to a macrotask lets
      // all in-flight disconnect events complete first.
      localPlayer?.disconnect()
      const v = localView
      setTimeout(() => v?.dispose(), 0)
    }
  }, [livekitUrl, avatarToken, roomName])

  // Preload the background image as soon as the component mounts so it is
  // ready by the time the avatar finishes loading.
  useEffect(() => {
    const img = new Image()
    img.src = AVATAR_BG
  }, [])

  return (
    // Entire layer (background + canvas) is invisible until onFirstRendering fires.
    // This prevents the background from appearing before the avatar is rendered.
    <div
      style={{
        position: 'fixed',
        inset: 0,
        opacity: status === 'ready' ? 1 : 0,
        transition: 'opacity 0.5s ease',
        // Block pointer events while hidden so clicks pass through to controls below.
        pointerEvents: status === 'ready' ? 'auto' : 'none',
      }}
    >
      {/* Background image — renders together with the avatar on first reveal */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url("${AVATAR_BG}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
        }}
      />
      {/*
        Avatar canvas — must be position:absolute so it forms a positioned
        element. DOM order (after the background div) ensures it stacks above
        the background. AvatarKit reads offsetWidth/offsetHeight so we keep
        explicit pixel dimensions matching the viewport.
      */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, width, height }} />
    </div>
  )
}
