export const MAX_MARKDOWN_FILE_BYTES = 1024 * 1024
export const MAX_CATALOG_CONTENT_CHARS = 100_000

export type MarkdownImport = { name: string; content: string }

export function decodeMarkdownImport(fileName: string, fileSize: number, bytes: ArrayBuffer): MarkdownImport {
  if (!/\.md$/i.test(fileName)) throw new Error('仅支持 .md 格式的 Markdown 文档')
  if (fileSize <= 0) throw new Error('Markdown 文档不能为空')
  if (fileSize > MAX_MARKDOWN_FILE_BYTES) throw new Error('Markdown 文档不能超过 1MB')

  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('文档不是有效的 UTF-8 编码，请转换编码后重试')
  }
  if (!content.trim()) throw new Error('Markdown 文档正文不能为空')
  if (content.length > MAX_CATALOG_CONTENT_CHARS) throw new Error('Markdown 文档正文不能超过 10 万字符')

  const name = fileName.replace(/\.md$/i, '').trim().slice(0, 100)
  if (!name) throw new Error('无法从文件名识别名称，请重命名后重试')
  return { name, content }
}
