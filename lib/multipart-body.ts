import 'server-only'

import Busboy from 'busboy'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { once } from 'node:events'
import type { NextRequest } from 'next/server'

/** A client error which can be translated directly into an HTTP response. */
export class MultipartBodyError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'MultipartBodyError'
  }
}

/**
 * Metadata for a streamed multipart file. The file is already on disk when
 * the parser resolves; the bytes are deliberately not retained in memory.
 */
export type ParsedMultipartFile = {
  fieldName: string
  filename: string
  mimeType: string
  filePath: string
  size: number
}

export type MultipartReadOptions = {
  fileField?: string
  maxFileBytes: number
  maxTotalBytes: number
  maxFields?: number
  maxFieldBytes?: number
  /** Where the streamed file should be created. Defaults to data/stt-temp. */
  tempDir?: string
  /** Optional allow-list. MIME matching is case-insensitive. */
  allowedMimeTypes?: readonly string[]
  /** Optional extension allow-list, with or without a leading dot. */
  allowedExtensions?: readonly string[]
}

const DEFAULT_TEMP_DIR = path.join(process.cwd(), 'data', 'stt-temp')
const DEFAULT_VIDEO_EXTENSIONS = [
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.flv', '.wmv',
  '.ts', '.mts', '.m2ts', '.3gp', '.mpeg', '.mpg', '.ogv',
] as const

function normaliseExtension(filename: string): string {
  return path.extname(filename).toLowerCase()
}

function safeFilename(filename: string): string {
  const base = path.basename(filename || 'upload')
  // Keep the extension for ffmpeg hints while excluding control characters,
  // path separators, and excessively long user supplied names.
  return base.replace(/[\u0000-\u001f\u007f\\/]+/g, '_').slice(0, 255) || 'upload'
}

function matchesMime(mimeType: string, allowList: readonly string[]): boolean {
  const value = mimeType.trim().toLowerCase()
  return allowList.some((candidate) => {
    const normalized = candidate.trim().toLowerCase()
    return normalized.endsWith('/*')
      ? value.startsWith(normalized.slice(0, -1))
      : value === normalized
  })
}

function validateVideoMetadata(
  filename: string,
  mimeType: string,
  options: MultipartReadOptions,
): void {
  const ext = normaliseExtension(filename)
  const allowedExtensions = (options.allowedExtensions || DEFAULT_VIDEO_EXTENSIONS)
    .map((entry) => entry.startsWith('.') ? entry.toLowerCase() : `.${entry.toLowerCase()}`)
  if (!ext || !allowedExtensions.includes(ext)) {
    throw new MultipartBodyError('仅支持常见视频格式', 415)
  }

  const allowedMimeTypes = options.allowedMimeTypes || ['video/*']
  const mimeAllowed = matchesMime(mimeType, allowedMimeTypes)
  // A few browsers send application/octet-stream for a video. It is safe to
  // accept that value only when the extension is an approved video extension;
  // ffprobe still performs the final media validation before transcription.
  const genericBinary = mimeType.trim().toLowerCase() === 'application/octet-stream'
  if (!mimeAllowed && !genericBinary) {
    throw new MultipartBodyError('文件 MIME 类型不是视频', 415)
  }
}

async function removeFile(filePath: string | undefined): Promise<void> {
  if (!filePath) return
  await fs.promises.rm(filePath, { force: true }).catch(() => undefined)
}

/**
 * Parse one streamed file from a multipart request.
 *
 * Busboy writes directly to a uniquely-created temporary file. This function
 * never concatenates file chunks or reads the upload into a Buffer, so memory
 * usage remains bounded by the stream high-water marks.
 */
export async function readSingleFileMultipart(
  req: NextRequest,
  options: MultipartReadOptions,
): Promise<{ file: ParsedMultipartFile; fields: Record<string, string> }> {
  const contentType = req.headers.get('content-type') || ''
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new MultipartBodyError('请求必须使用 multipart/form-data', 415)
  }
  if (!req.body) throw new MultipartBodyError('请求体不能为空', 400)

  if (!Number.isSafeInteger(options.maxFileBytes) || options.maxFileBytes <= 0) {
    throw new Error('maxFileBytes must be a positive integer')
  }
  if (!Number.isSafeInteger(options.maxTotalBytes) || options.maxTotalBytes <= 0) {
    throw new Error('maxTotalBytes must be a positive integer')
  }

  const declared = Number(req.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > options.maxTotalBytes) {
    throw new MultipartBodyError('上传请求过大', 413)
  }

  const fileField = options.fileField || 'file'
  const tempDir = options.tempDir || DEFAULT_TEMP_DIR
  const fields: Record<string, string> = {}
  let filePath: string | undefined

  return new Promise((resolve, reject) => {
    let settled = false
    let total = 0
    let parser: ReturnType<typeof Busboy> | undefined
    let filePromise: Promise<ParsedMultipartFile> | undefined
    let sawFile = false

    const cleanupAndReject = (error: unknown) => {
      if (settled) return
      settled = true
      void removeFile(filePath)
      reject(error instanceof MultipartBodyError
        ? error
        : new MultipartBodyError('上传数据格式无效', 400))
    }

    try {
      parser = Busboy({
        headers: Object.fromEntries(req.headers.entries()),
        limits: {
          fileSize: options.maxFileBytes,
          files: 1,
          fields: options.maxFields ?? 4,
          fieldSize: options.maxFieldBytes ?? 8 * 1024,
          parts: (options.maxFields ?? 4) + 1,
          headerPairs: 100,
        },
      })
    } catch {
      cleanupAndReject(new MultipartBodyError('multipart 请求头无效', 400))
      return
    }

    const source = Readable.fromWeb(req.body as never)
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length
        if (total > options.maxTotalBytes) {
          callback(new MultipartBodyError('上传请求过大', 413))
          return
        }
        callback(null, chunk)
      },
    })

    parser.on('file', (fieldName, stream, info) => {
      sawFile = true
      if (fieldName !== fileField) {
        stream.resume()
        cleanupAndReject(new MultipartBodyError('文件字段无效', 400))
        return
      }
      if (filePromise) {
        stream.resume()
        cleanupAndReject(new MultipartBodyError('一次只能上传一个文件', 400))
        return
      }

      const filename = safeFilename(String(info.filename || 'upload'))
      const mimeType = String(info.mimeType || 'application/octet-stream').slice(0, 100)
      try {
        validateVideoMetadata(filename, mimeType, options)
      } catch (error) {
        stream.resume()
        cleanupAndReject(error)
        return
      }

      // Pause until the directory and exclusive destination are ready. A
      // random name prevents collisions and avoids trusting the client name.
      stream.pause()
      filePromise = (async () => {
        await fs.promises.mkdir(tempDir, { recursive: true })
        filePath = path.join(tempDir, `${randomUUID()}${normaliseExtension(filename)}`)
        const output = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 })
        let size = 0
        let limited = false
        const onData = (chunk: Buffer) => { size += chunk.length }
        stream.on('data', onData)
        stream.on('limit', () => { limited = true })
        stream.on('error', (error) => output.destroy(error))
        stream.pipe(output)
        stream.resume()
        await once(output, 'finish')
        stream.off('data', onData)
        if (limited || stream.truncated || size > options.maxFileBytes) {
          await removeFile(filePath)
          filePath = undefined
          throw new MultipartBodyError('上传文件过大', 413)
        }
        if (size === 0) {
          await removeFile(filePath)
          filePath = undefined
          throw new MultipartBodyError('请选择文件', 400)
        }
        return { fieldName, filename, mimeType, filePath, size }
      })()
      // If the outer parser aborts before its `close` event, avoid leaving an
      // unhandled stream/write rejection behind and remove the partial file.
      void filePromise.catch((error) => {
        cleanupAndReject(error)
      })
    })
    parser.on('field', (name, value, info) => {
      if (info.valueTruncated) {
        cleanupAndReject(new MultipartBodyError('表单字段过大', 413))
        return
      }
      fields[name] = value
    })
    parser.on('filesLimit', () => cleanupAndReject(new MultipartBodyError('一次只能上传一个文件', 400)))
    parser.on('fieldsLimit', () => cleanupAndReject(new MultipartBodyError('表单字段过多', 400)))
    parser.on('partsLimit', () => cleanupAndReject(new MultipartBodyError('表单内容过多', 400)))
    parser.on('error', cleanupAndReject)
    limiter.on('error', cleanupAndReject)
    source.on('error', cleanupAndReject)
    parser.on('close', () => {
      if (settled) return
      if (!sawFile || !filePromise) {
        cleanupAndReject(new MultipartBodyError('请选择文件', 400))
        return
      }
      void filePromise.then((file) => {
        if (settled) {
          void removeFile(file.filePath)
          return
        }
        settled = true
        resolve({ file, fields })
      }).catch(cleanupAndReject)
    })

    source.pipe(limiter).pipe(parser)
  })
}
