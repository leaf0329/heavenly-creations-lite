import 'server-only'

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** The maximum size accepted by the STT upload/download pipeline. */
export const DEFAULT_STT_MAX_BYTES = 500 * 1024 * 1024
export const DEFAULT_MEDIA_TIMEOUT_MS = 120_000

function resolveBinary(envName: 'FFMPEG_PATH' | 'FFPROBE_PATH', fallback: string): string {
  const configured = process.env[envName]?.trim()
  if (configured) return configured
  try {
    execFileSync(fallback, ['-version'], { stdio: 'ignore', timeout: 3_000, windowsHide: true })
    return fallback
  } catch {
    if (process.env.NODE_ENV !== 'production') {
      const local = path.join(process.cwd(), '.local-tools', `${fallback}.exe`)
      if (fs.existsSync(local)) return local
    }
    // Returning the executable name keeps errors useful when the binary is
    // missing; callers receive a controlled media-command failure.
    return fallback
  }
}

export const FFMPEG = resolveBinary('FFMPEG_PATH', 'ffmpeg')
export const FFPROBE = resolveBinary('FFPROBE_PATH', 'ffprobe')

const processState = globalThis as typeof globalThis & {
  __hc_lite_media_processes?: Map<string, Set<ChildProcess>>
  __hc_lite_media_shutdown_hook?: boolean
}
const mediaProcesses = processState.__hc_lite_media_processes || new Map<string, Set<ChildProcess>>()
processState.__hc_lite_media_processes = mediaProcesses

if (!processState.__hc_lite_media_shutdown_hook) {
  processState.__hc_lite_media_shutdown_hook = true
  const terminate = () => {
    for (const children of mediaProcesses.values()) {
      for (const child of children) child.kill('SIGTERM')
    }
  }
  process.once('SIGTERM', terminate)
  process.once('SIGINT', terminate)
}

function addProcess(jobId: string, child: ChildProcess): Set<ChildProcess> {
  const children = mediaProcesses.get(jobId) || new Set<ChildProcess>()
  children.add(child)
  mediaProcesses.set(jobId, children)
  return children
}

function removeProcess(jobId: string, child: ChildProcess, children: Set<ChildProcess>): void {
  children.delete(child)
  if (!children.size) mediaProcesses.delete(jobId)
}

/** Run ffmpeg/ffprobe without a shell, bounded output, and a hard timeout. */
export async function runMediaCommand(
  binary: string,
  args: readonly string[],
  timeoutMs = DEFAULT_MEDIA_TIMEOUT_MS,
  jobId = 'untracked',
): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('媒体命令超时时间无效')
  await new Promise<void>((resolve, reject) => {
    let finished = false
    let timedOut = false
    let stderr = ''
    const child = spawn(binary, [...args], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const children = addProcess(jobId, child)
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      removeProcess(jobId, child, children)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // Windows may not deliver SIGTERM to a process which has already
      // detached. A short follow-up keeps the request from hanging forever.
      const forceTimer = setTimeout(() => child.kill('SIGKILL'), 2_000)
      forceTimer.unref?.()
      finish(new Error('FFmpeg 执行超时'))
    }, timeoutMs)
    timer.unref?.()

    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderr.length < 2 * 1024 * 1024) stderr += chunk.toString()
    })
    child.once('error', (error) => finish(error instanceof Error ? error : new Error(String(error))))
    child.once('close', (code, signal) => {
      if (finished) return
      if (timedOut) return
      if (code === 0) {
        finish()
        return
      }
      const suffix = stderr.trim().slice(-800)
      finish(new Error(`FFmpeg 执行失败 (${(code ?? signal) || 'unknown'})${suffix ? `: ${suffix}` : ''}`))
    })
  })
}

export function cancelMediaCommands(jobId: string): void {
  const children = mediaProcesses.get(jobId)
  if (!children) return
  for (const child of children) child.kill('SIGTERM')
}

function ensureOutputPath(filePath: string): void {
  if (!path.isAbsolute(filePath)) throw new Error('媒体输出路径必须是绝对路径')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

/** Extract mono, 16 kHz MP3 suitable for the OpenAI transcription endpoint. */
export async function extractAudio(
  videoPath: string,
  audioPath?: string,
  jobId = 'untracked',
): Promise<string> {
  if (!fs.existsSync(videoPath)) throw new Error('视频临时文件不存在')
  const output = audioPath || path.join(path.dirname(videoPath), `${path.basename(videoPath, path.extname(videoPath))}.mp3`)
  ensureOutputPath(output)
  await runMediaCommand(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', videoPath,
    '-vn', '-ar', '16000', '-ac', '1',
    '-codec:a', 'libmp3lame', '-b:a', '32k',
    output,
  ], 120_000, jobId)
  if (!fs.existsSync(output) || fs.statSync(output).size <= 0) throw new Error('音频文件未生成')
  return output
}

/** Split an audio file into bounded MP3 chunks for providers with size limits. */
export async function splitAudio(
  audioPath: string,
  dir: string,
  segmentSeconds: number,
  jobId = 'untracked',
): Promise<string[]> {
  if (!Number.isFinite(segmentSeconds) || segmentSeconds <= 0) return []
  if (!fs.existsSync(audioPath)) throw new Error('音频临时文件不存在')
  fs.mkdirSync(dir, { recursive: true })
  const prefix = path.join(dir, `stt-segment-${jobId.replace(/[^a-zA-Z0-9_-]/g, '') || 'job'}-`)
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(path.basename(prefix))) {
      fs.rmSync(path.join(dir, entry), { force: true })
    }
  }
  await runMediaCommand(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', audioPath,
    '-f', 'segment', '-segment_time', String(Math.floor(segmentSeconds)),
    '-c', 'copy', `${prefix}%03d.mp3`,
  ], 180_000, jobId)
  return fs.readdirSync(dir)
    .filter((entry) => entry.startsWith(path.basename(prefix)) && entry.endsWith('.mp3'))
    .sort()
    .map((entry) => path.join(dir, entry))
}

/** Validate that ffmpeg can read a file without retaining media data. */
export async function probeMedia(filePath: string, jobId = 'untracked'): Promise<void> {
  if (!fs.existsSync(filePath)) throw new Error('视频临时文件不存在')
  await runMediaCommand(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-i', filePath,
    '-map', '0:v:0', '-f', 'null', '-',
  ], 60_000, jobId)
}
