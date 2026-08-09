import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const KEYSTREAM_SIZE = 131_072
const runtimeDir = path.join(process.cwd(), 'vendor', 'wechat-channels-decrypt')
const loaderPath = path.join(runtimeDir, 'wasm_video_decode.js')
const wasmPath = path.join(runtimeDir, 'wasm_video_decode.wasm')

interface IsaacInstance {
  generate(size: number): void
  delete(): void
}

interface WasmModule {
  HEAPU8: Uint8Array
  WxIsaac64: new (decodeKey: string) => IsaacInstance
  onRuntimeInitialized?: () => void
}

class LocalFileXhr {
  responseType = ''
  response: ArrayBuffer | string = ''
  responseText = ''
  status = 0
  onload?: () => void
  onerror?: (error: unknown) => void
  private url = ''

  open(_method: string, url: string): void { this.url = url }
  setRequestHeader(): void {}
  send(): void {
    try {
      const buffer = fs.readFileSync(this.url)
      this.status = 200
      this.responseText = buffer.toString()
      this.response = this.responseType === 'arraybuffer'
        ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        : this.responseText
      this.onload?.()
    } catch (error) {
      this.status = 404
      if (this.onerror) this.onerror(error)
      else throw error
    }
  }
}

let runtimePromise: Promise<{ module: WasmModule; takeStream: () => Buffer }> | null = null
const streamCache = new Map<string, Buffer>()
let generationQueue: Promise<void> = Promise.resolve()

async function loadRuntime(): Promise<{ module: WasmModule; takeStream: () => Buffer }> {
  if (runtimePromise) return runtimePromise
  runtimePromise = new Promise((resolve, reject) => {
    let stream: Buffer | null = null
    const runtimeModule = {} as WasmModule
    const context = {
      console,
      WebAssembly,
      TextDecoder,
      TextEncoder,
      performance,
      XMLHttpRequest: LocalFileXhr,
      VTS_WASM_URL: wasmPath,
      fetch: undefined,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      URL,
      AbortController,
      document: { title: '' },
      location: { href: `file:///${loaderPath.replace(/\\/g, '/')}` },
      Module: runtimeModule,
      wasm_isaac_generate(pointer: number, size: number) {
        stream = Buffer.from(new Uint8Array(runtimeModule.HEAPU8.buffer, pointer, size)).reverse()
      },
      wasm_ffmpeg_error_report() {},
      wasm_ffmpeg_fwrite() { return 0 },
      wasm_ffmpeg_fsize() {},
      wasm_ffmpeg_fseek() {},
      wasm_ffmpeg_fclose() {},
    }
    const vmContext = vm.createContext(context)
    Object.assign(vmContext, { self: vmContext })
    runtimeModule.onRuntimeInitialized = () => resolve({
      module: runtimeModule,
      takeStream: () => {
        if (!stream) throw new Error('视频号解密密钥流生成失败')
        const result = stream
        stream = null
        return result
      },
    })
    try {
      vm.runInContext(fs.readFileSync(loaderPath, 'utf8'), vmContext, { filename: loaderPath })
    } catch (error) {
      runtimePromise = null
      reject(error)
    }
  })
  return runtimePromise
}

export async function generateWeChatKeystream(decodeKey: string): Promise<Buffer> {
  const cached = streamCache.get(decodeKey)
  if (cached) return Buffer.from(cached)
  let result: Buffer | null = null
  const run = generationQueue.then(async () => {
    const again = streamCache.get(decodeKey)
    if (again) { result = Buffer.from(again); return }
    const runtime = await loadRuntime()
    const instance = new runtime.module.WxIsaac64(decodeKey)
    try { instance.generate(KEYSTREAM_SIZE) } finally { instance.delete() }
    const stream = runtime.takeStream()
    if (stream.length !== KEYSTREAM_SIZE) throw new Error('视频号解密密钥流长度异常')
    if (streamCache.size >= 10) streamCache.delete(streamCache.keys().next().value!)
    streamCache.set(decodeKey, stream)
    result = Buffer.from(stream)
  })
  generationQueue = run.then(() => undefined, () => undefined)
  await run
  if (!result) throw new Error('视频号解密密钥流生成失败')
  return result
}

export async function decryptWeChatMediaFile(filePath: string, decodeKey: string): Promise<void> {
  const stream = await generateWeChatKeystream(decodeKey)
  const handle = await fs.promises.open(filePath, 'r+')
  try {
    const stats = await handle.stat()
    const length = Math.min(KEYSTREAM_SIZE, stats.size)
    const chunk = Buffer.alloc(length)
    const { bytesRead } = await handle.read(chunk, 0, length, 0)
    for (let index = 0; index < bytesRead; index++) chunk[index] ^= stream[index]!
    if (chunk.toString('ascii', 4, 8) !== 'ftyp') throw new Error('视频号媒体解密失败，请重试或检查分享链接是否有效')
    await handle.write(chunk, 0, bytesRead, 0)
  } finally {
    await handle.close()
  }
}
