import { describe, expect, test } from 'bun:test'
import { FileObject, type FileRecord } from './file-object'

const NOW = new Date('2026-10-23T08:00:00Z')
const OWNER = { accountKind: 'staff', accountId: 'a1' } as const

const file = (over: Partial<FileRecord> = {}) =>
  new FileObject({
    id: 'f1',
    buildingId: 'b1',
    module: 'building',
    purpose: 'building_logo',
    objectKey: 'k',
    mime: 'image/png',
    size: 10,
    checksum: null,
    status: 'pending',
    ownerRef: null,
    accountKind: 'staff',
    accountId: 'a1',
    createdAt: NOW,
    ...over,
  } as FileRecord)

describe('FileObject.verify', () => {
  test('a pending file becomes verified with the real size', () => {
    expect(file().verify(99, NOW)).toEqual({
      id: 'f1',
      expect: { status: 'pending' },
      set: { status: 'verified', verifiedAt: NOW, size: 99 },
    })
  })

  test('any other status has nothing to verify', () => {
    for (const status of ['verified', 'attached', 'deleted'] as const)
      expect(file({ status }).verify(99, NOW)).toBeNull()
  })
})

describe('FileObject.attach', () => {
  test('a verified file attaches for the account that registered it', () => {
    expect(file({ status: 'verified' }).attach('building:b1', OWNER, NOW)).toEqual({
      id: 'f1',
      expect: { status: 'verified', accountKind: 'staff', accountId: 'a1' },
      set: { status: 'attached', attachedAt: NOW, ownerRef: 'building:b1' },
    })
  })

  test('another account, an unverified file and an attached one are refused', () => {
    const verified = file({ status: 'verified' })
    expect(verified.attach('x', { accountKind: 'staff', accountId: 'a2' }, NOW)).toBeNull()
    expect(file().attach('x', OWNER, NOW)).toBeNull()
    expect(file({ status: 'attached' }).attach('x', OWNER, NOW)).toBeNull()
  })
})

describe('FileObject.delete', () => {
  test('a live file is deleted and guards on the status it read', () => {
    for (const status of ['pending', 'verified', 'attached'] as const)
      expect(file({ status }).delete(NOW)).toEqual({
        id: 'f1',
        expect: { status },
        set: { status: 'deleted', deletedAt: NOW },
      })
  })

  test('a deleted file has nothing to delete', () => {
    expect(file({ status: 'deleted' }).delete(NOW)).toBeNull()
  })
})

describe('FileObject.completeGenerated', () => {
  test('a pending generated file is attached at once with its size and checksum', () => {
    expect(file().completeGenerated({ size: 5, checksum: 'c' }, NOW)?.set).toEqual({
      status: 'attached',
      verifiedAt: NOW,
      attachedAt: NOW,
      size: 5,
      checksum: 'c',
    })
  })

  test('a file that is not pending is refused', () => {
    expect(
      file({ status: 'attached' }).completeGenerated({ size: 5, checksum: 'c' }, NOW),
    ).toBeNull()
  })
})
