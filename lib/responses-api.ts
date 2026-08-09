export type ResponsesTextRequestOptions = {
  model: string
  instructions: string
  input: string
  temperature?: number
  maxOutputTokens?: number
}

/** Builds the text-only Responses request shared by all HCLite text jobs. */
export function buildResponsesTextRequest(options: ResponsesTextRequestOptions): Record<string, unknown> {
  return {
    model: options.model,
    instructions: options.instructions,
    input: options.input,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxOutputTokens === undefined ? {} : { max_output_tokens: options.maxOutputTokens }),
    // Results are persisted in the HCLite jobs table, not at the provider.
    store: false,
  }
}

export function joinResponsesUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, '')
  if (!base) return '/responses'
  return /\/responses$/i.test(base) ? base : `${base}/responses`
}

