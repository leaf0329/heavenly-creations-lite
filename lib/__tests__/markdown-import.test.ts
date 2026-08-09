import { describe, expect, it } from 'vitest'
import { decodeMarkdownImport, MAX_MARKDOWN_FILE_BYTES } from '../markdown-import'

function bytes(value: number[]): ArrayBuffer {
  return Uint8Array.from(value).buffer
}

describe('Markdown catalog import', () => {
  it('imports UTF-8 without BOM and preserves front matter', () => {
    const content = '---\nname: 示例\n---\n\n# 正文'
    const encoded = new TextEncoder().encode(content)
    expect(decodeMarkdownImport('门店档案.md', encoded.byteLength, encoded.buffer)).toEqual({
      name: '门店档案', content,
    })
  })

  it('accepts UTF-8 BOM and removes only the BOM marker', () => {
    const encoded = new TextEncoder().encode('Skill 正文')
    const input = Uint8Array.from([0xef, 0xbb, 0xbf, ...encoded])
    expect(decodeMarkdownImport('method.MD', input.byteLength, input.buffer)).toEqual({
      name: 'method', content: 'Skill 正文',
    })
  })

  it('rejects invalid extension, invalid UTF-8, oversized and empty files', () => {
    expect(() => decodeMarkdownImport('note.txt', 1, bytes([65]))).toThrow('仅支持 .md')
    expect(() => decodeMarkdownImport('note.md', 2, bytes([0xc3, 0x28]))).toThrow('不是有效的 UTF-8')
    expect(() => decodeMarkdownImport('note.md', MAX_MARKDOWN_FILE_BYTES + 1, bytes([65]))).toThrow('不能超过 1MB')
    expect(() => decodeMarkdownImport('note.md', 1, bytes([32]))).toThrow('正文不能为空')
  })
})
