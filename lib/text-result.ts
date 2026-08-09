const TEXT_KEYS = ['text', 'content', 'output_text', 'answer', 'result'] as const

function stripCodeFenceOnly(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^```(?:json|markdown|md|text)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i)
  return match ? match[1]!.trim() : trimmed
}

function stripOuterMarkup(value: string): string {
  return stripCodeFenceOnly(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<(?:p|div|ul|ol|li|h[1-6])(?:\s[^>]*)?>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseStructuredString(value: string): unknown {
  const stripped = stripOuterMarkup(value)
  if (!stripped || !['{', '[', '"'].includes(stripped[0]!)) return stripped
  try {
    return JSON.parse(stripped)
  } catch {
    return stripped
  }
}

export function extractTextResult(value: unknown, depth = 0): string {
  if (depth > 10 || value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const parsed = parseStructuredString(value)
    return typeof parsed === 'string' ? stripOuterMarkup(parsed) : extractTextResult(parsed, depth + 1)
  }
  if (Array.isArray(value)) {
    return value.map(item => extractTextResult(item, depth + 1)).filter(Boolean).join('\n').trim()
  }
  if (typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  if (Array.isArray(record.choices)) {
    const text = record.choices.map(choice => {
      if (!choice || typeof choice !== 'object') return ''
      const item = choice as Record<string, unknown>
      return extractTextResult(item.message, depth + 1) || extractTextResult(item.text, depth + 1)
    }).filter(Boolean).join('\n').trim()
    if (text) return text
  }
  if (record.message !== undefined) {
    const text = extractTextResult(record.message, depth + 1)
    if (text) return text
  }
  for (const key of TEXT_KEYS) {
    if (record[key] === undefined) continue
    const text = extractTextResult(record[key], depth + 1)
    if (text) return text
  }
  if (record.output !== undefined) return extractTextResult(record.output, depth + 1)
  return ''
}

/** Extract text without converting markup beyond an outer code fence. */
export function extractRawTextResult(value: unknown, depth = 0): string {
  if (depth > 10 || value === null || value === undefined) return ''
  if (typeof value === 'string') return stripCodeFenceOnly(value)
  if (Array.isArray(value)) return value.map(item => extractRawTextResult(item, depth + 1)).filter(Boolean).join('\n').trim()
  if (typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (Array.isArray(record.choices)) {
    const text = record.choices.map(choice => extractRawTextResult(choice, depth + 1)).filter(Boolean).join('\n').trim()
    if (text) return text
  }
  if (record.message !== undefined) {
    const text = extractRawTextResult(record.message, depth + 1)
    if (text) return text
  }
  for (const key of ['content', 'text', 'output_text'] as const) {
    if (record[key] === undefined) continue
    const text = extractRawTextResult(record[key], depth + 1)
    if (text) return text
  }
  if (record.output !== undefined) return extractRawTextResult(record.output, depth + 1)
  return ''
}

export function parseStoredJobResult(raw: unknown): { text: string } {
  const text = extractTextResult(raw)
  return { text }
}

