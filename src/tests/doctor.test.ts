import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import { __resetLibVersionCacheForTests, getDoctorStatus } from '@/core/doctor'
import { pkg } from '@/core/package-data'

describe('getDoctorStatus — lib version cache', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    __resetLibVersionCacheForTests()
  })

  test('does not re-fetch the npm registry on a second call within the TTL', async () => {
    __resetLibVersionCacheForTests()

    let callCount = 0
    globalThis.fetch = (async () => {
      callCount++
      return {
        json: async () => ({ version: pkg.version }),
      } as Response
    }) as typeof fetch

    const first = await getDoctorStatus('/nonexistent-cwd-for-doctor-test')
    const second = await getDoctorStatus('/nonexistent-cwd-for-doctor-test')

    assert.equal(callCount, 1, 'expected the npm registry to be fetched only once')
    assert.deepEqual(first.lib, second.lib)
  })

  test('refetches after the in-memory cache is reset', async () => {
    __resetLibVersionCacheForTests()

    let callCount = 0
    globalThis.fetch = (async () => {
      callCount++
      return {
        json: async () => ({ version: pkg.version }),
      } as Response
    }) as typeof fetch

    await getDoctorStatus('/nonexistent-cwd-for-doctor-test')
    __resetLibVersionCacheForTests()
    await getDoctorStatus('/nonexistent-cwd-for-doctor-test')

    assert.equal(callCount, 2, 'expected a fresh fetch after cache reset')
  })
})
