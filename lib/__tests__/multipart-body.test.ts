import fs from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { MultipartBodyError, readSingleFileMultipart } from '../multipart-body'

const tempRoot = path.join(process.cwd(), 'data', 'stt-temp-test')

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true })
})

function requestWithFile(name = 'clip.mp4', mime = 'video/mp4', bytes = new Uint8Array([1, 2, 3])): NextRequest {
  const form = new FormData()
  form.append('title', 'demo')
  form.append('file', new Blob([bytes], { type: mime }), name)
  return new NextRequest('http://127.0.0.1/api/transcriptions/upload', { method: 'POST', body: form })
}

describe('streamed multipart video uploads', () => {
  it('writes the file to disk without returning bytes', async () => {
    const parsed = await readSingleFileMultipart(requestWithFile(), {
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
      tempDir: tempRoot,
    })
    expect(parsed.file.filePath.startsWith(tempRoot)).toBe(true)
    expect(parsed.file.size).toBe(3)
    expect('bytes' in parsed.file).toBe(false)
    await expect(fs.readFile(parsed.file.filePath)).resolves.toEqual(Buffer.from([1, 2, 3]))
  })

  it('rejects non-video extensions before writing', async () => {
    await expect(readSingleFileMultipart(requestWithFile('clip.txt', 'text/plain'), {
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
      tempDir: tempRoot,
    })).rejects.toMatchObject({ status: 415 })
  })

  it('enforces the streamed file limit', async () => {
    await expect(readSingleFileMultipart(requestWithFile('clip.mp4', 'video/mp4', new Uint8Array(20)), {
      maxFileBytes: 5,
      maxTotalBytes: 4096,
      tempDir: tempRoot,
    })).rejects.toMatchObject({ status: 413 })
    await expect(fs.readdir(tempRoot)).resolves.toEqual([])
  })

  it('rejects non-multipart requests', async () => {
    const request = new NextRequest('http://127.0.0.1', { method: 'POST', body: 'plain text' })
    await expect(readSingleFileMultipart(request, {
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
      tempDir: tempRoot,
    })).rejects.toBeInstanceOf(MultipartBodyError)
  })
})
