import 'server-only'

import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import OSS from 'ali-oss'
import { getAlibabaAccessCredentials } from './alibaba-credentials'

const UUID = /^[0-9a-f-]{36}$/i

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} must be configured`)
  return value
}

function region(): string {
  return process.env.OSS_REGION?.trim() || 'oss-cn-shenzhen'
}

function bucket(): string {
  return required('OSS_BUCKET')
}

async function client(internal: boolean): Promise<OSS> {
  const credentials = await getAlibabaAccessCredentials()
  const endpoint = required(internal ? 'OSS_INTERNAL_ENDPOINT' : 'OSS_PUBLIC_ENDPOINT')
  return new OSS({
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    stsToken: credentials.securityToken,
    bucket: bucket(),
    region: region(),
    endpoint,
    secure: true,
    authorizationV4: true,
  })
}

function extension(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12)
  return ext && ext !== '.' ? ext : '.bin'
}

export function createUploadObjectKey(userId: string, filename: string): string {
  if (!UUID.test(userId)) throw new Error('用户标识无效')
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '/')
  return `uploads/${date}/${userId}/${crypto.randomUUID()}${extension(filename)}`
}

export function isOwnedUploadObjectKey(objectKey: string, userId: string): boolean {
  return UUID.test(userId)
    && /^[a-zA-Z0-9][a-zA-Z0-9/_\-.]{0,500}$/.test(objectKey)
    && !objectKey.includes('..')
    && objectKey.includes(`/${userId}/`)
    && objectKey.startsWith('uploads/')
}

export async function createUploadUrl(objectKey: string, mimeType: string): Promise<string> {
  const oss = await client(false)
  return oss.signatureUrlV4('PUT', 600, { headers: { 'Content-Type': mimeType } }, objectKey)
}

export async function statObject(objectKey: string): Promise<{ size: number; contentType: string }> {
  const oss = await client(true)
  const result = await oss.head(objectKey)
  const headers = (result.res?.headers || {}) as Record<string, string | string[] | undefined>
  return {
    size: Number(headers['content-length'] || 0),
    contentType: String(headers['content-type'] || ''),
  }
}

export async function downloadObject(objectKey: string, targetPath: string): Promise<void> {
  const oss = await client(true)
  const url = await oss.signatureUrlV4('GET', 600, {}, objectKey)
  const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) })
  if (!response.ok || !response.body) throw new Error(`OSS 文件读取失败 (${response.status})`)
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
  await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(targetPath, { flags: 'wx' }))
}

export async function deleteObject(objectKey: string): Promise<void> {
  const oss = await client(true)
  await oss.delete(objectKey)
}
