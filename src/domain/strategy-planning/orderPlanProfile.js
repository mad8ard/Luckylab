import { scaleProfileToMarket, strategyProfiles } from './strategyProfile.js'

export function ensureExecutableProfile(profile, market) {
  if (Number.isFinite(profile?.minEdge) && Number.isFinite(profile?.riskMin)) return profile
  return scaleProfileToMarket(profile ?? strategyProfiles.balanced, market)
}
