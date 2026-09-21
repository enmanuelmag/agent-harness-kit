import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { resolveStorageScope } from '@/commands/init'

import type { StorageScopeSelect } from '@/commands/init'

describe('resolveStorageScope', () => {
  test('requests local/global storage with global preselected when no valid flag is supplied', async () => {
    let receivedOptions: Parameters<StorageScopeSelect>[0] | undefined

    const scope = await resolveStorageScope(undefined, async (options) => {
      receivedOptions = options
      return 'global'
    })

    assert.equal(scope, 'global')
    assert.deepEqual(receivedOptions, {
      message: 'Storage scope',
      options: [
        { value: 'local', label: 'Local — .harness/harness.db lives in this project' },
        {
          value: 'global',
          label: 'Global — DB lives under ~/.harness/dbs/<projectId>/, outside the project',
        },
      ],
      initialValue: 'global',
    })
  })

  test('an explicit local flag bypasses the interactive picker and returns local', async () => {
    const scope = await resolveStorageScope('local', async () => {
      throw new Error('storage picker must not run when --storage-scope local is supplied')
    })

    assert.equal(scope, 'local')
  })
})
