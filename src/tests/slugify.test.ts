import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { slugify } from '../core/materializer/scaffold-utils.js'

describe('slugify', () => {
  test('lowercases and replaces spaces', () => {
    assert.equal(slugify('My Feature'), 'my-feature')
  })

  test('strips leading and trailing dashes', () => {
    assert.equal(slugify('  hello  '), 'hello')
  })

  test('collapses multiple special chars', () => {
    assert.equal(slugify('foo!!!bar'), 'foo-bar')
  })

  test('truncates at 64 chars', () => {
    const long = 'a'.repeat(100)
    assert.equal(slugify(long).length, 64)
  })
})
