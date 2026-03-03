import { withAvatarkit } from '@spatialwalk/avatarkit/next'

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // avatarkit-rtc bundles an Agora adapter that imports this package.
    // We only use the LiveKit adapter, so silence the missing-module warning.
    config.resolve.alias['agora-rtc-sdk-ng'] = false
    return config
  },
}

export default withAvatarkit(nextConfig)
