import { expect, test } from 'bun:test'
import { IOSConfig } from 'expo/config-plugins'
import config from './app.config'

/**
 * UA-29 (DOC-104 §9.2): the privacy manifest of the staff app holds the one collected data type of the usage record, merged the way
 * the build writes it to `PrivacyInfo.xcprivacy`, and nothing asks for tracking.
 */
test('UA-29 the manifest declares Product Interaction for analytics, not linked and not tracking', () => {
  const merged = IOSConfig.PrivacyInfo.mergePrivacyInfo({}, config.ios?.privacyManifests ?? {})
  expect(merged.NSPrivacyTracking).toBe(false)
  expect(merged.NSPrivacyTrackingDomains).toEqual([])
  expect(merged.NSPrivacyCollectedDataTypes).toEqual([
    {
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeProductInteraction',
      NSPrivacyCollectedDataTypeLinked: false,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAnalytics'],
    },
  ])
})

test('UA-29 Info.plist has no NSUserTrackingUsageDescription', () => {
  expect(Object.keys(config.ios?.infoPlist ?? {})).not.toContain('NSUserTrackingUsageDescription')
})
