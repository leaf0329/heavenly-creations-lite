import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { removeSttTemporaryPath, toPublicSttJob } from '../stt'
import type { JobRecord } from '../jobs'

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: '2b8d7f31-ec6f-4ef8-9f3d-37e9cf07cb18',
    userId: '3a258761-3f4c-4af7-b0f1-fbe8d260919c',
    type: 'stt',
    status: 'completed',
    title: 'clip',
    input: {},
    resultText: '你好',
    sourceKind: 'upload',
    sourceUrl: null,
    sourceFilename: 'clip.mp4',
    temporaryPath: path.join(process.cwd(), 'data', 'stt-temp', 'unit-test.mp4'),
    sourceMetadata: { mimeType: 'video/mp4' },
    progress: 100,
    progressMessage: '已完成',
    attemptCount: 1,
    maxAttempts: 2,
    retryAt: null,
    processingToken: 'secret-token',
    leaseUntil: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('STT public projection and cleanup', () => {
  it('omits temporary paths and processing tokens', () => {
    const publicJob = toPublicSttJob(job()) as Record<string, unknown>
    expect(publicJob.resultText).toBe('你好')
    expect(publicJob).not.toHaveProperty('temporaryPath')
    expect(publicJob).not.toHaveProperty('processingToken')
    expect(publicJob).not.toHaveProperty('input')
  })

  it('removes only paths under the STT temporary root', async () => {
    const safe = path.join(process.cwd(), 'data', 'stt-temp', 'unit-test.mp4')
    await fs.mkdir(path.dirname(safe), { recursive: true })
    await fs.writeFile(safe, 'temporary')
    await removeSttTemporaryPath(safe)
    await expect(fs.access(safe)).rejects.toBeTruthy()

    const outside = path.join(process.cwd(), 'stt-cleanup-sentinel.tmp')
    await fs.writeFile(outside, 'keep')
    await removeSttTemporaryPath(outside)
    await expect(fs.readFile(outside, 'utf8')).resolves.toBe('keep')
    await fs.rm(outside, { force: true })
  })
})
