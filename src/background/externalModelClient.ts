import { streamText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ExternalModelConfig, ExternalModelFormat } from '../group/types'

export class ExternalModelError extends Error {
  constructor(public message: string, public status?: number, public code?: string) {
    super(message)
    this.name = 'ExternalModelError'
  }

  get friendlyMessage(): string {
    if (this.status === 401 || this.status === 403) return 'Invalid API Key or insufficient permissions. Please check the configuration'
    if (this.status === 429) return 'Too many requests. Please try again later (Rate Limit)'
    if (this.status === 404) return 'Incorrect model name or endpoint path'
    if (this.status && this.status >= 500) return 'The model server encountered an internal error. Please try again later'
    if (this.message.includes('timeout') || this.message.includes('Network')) return 'Network connection timed out. Please check BaseURL and network settings'
    return this.message
  }
}

export interface ExternalModelCompletionInput {
  model: ExternalModelConfig
  prompt: string
  abortSignal?: AbortSignal
}

export interface ExternalModelCompletionResult {
  content: string
}

export interface ExternalModelClient {
  stream?(input: ExternalModelCompletionInput): AsyncIterable<string>
  complete(input: ExternalModelCompletionInput): Promise<ExternalModelCompletionResult>
}

function normalizeBaseUrl(url: string, format: ExternalModelFormat): string {
  let normalized = url.trim().replace(/\/+$/, '')
  if (format === 'openai') {
    if (!normalized.endsWith('/v1')) {
      normalized += '/v1'
    }
  }
  return normalized
}

export function createExternalModelClient(fetchImpl: typeof fetch = fetch): ExternalModelClient {
  let lastResponseMetadata: Record<string, unknown> = {}

  const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchImpl(input, init)
    lastResponseMetadata = {
      url: input instanceof Request ? input.url : String(input),
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    }
    return response
  }

  return {
    stream(input) {
      return streamExternalModel(input, wrappedFetch)
    },
    async complete(input) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      try {
        let content = ''
        const normalizedUrl = normalizeBaseUrl(input.model.baseUrl, input.model.format)
        const stream = streamExternalModel({ ...input, abortSignal: controller.signal }, wrappedFetch)
        for await (const chunk of stream) content += chunk
        if (!content.trim()) {
          throw new ExternalModelError(
            `External model returned empty content (URL: ${normalizedUrl}, Model: ${input.model.modelName}, Response: ${JSON.stringify(lastResponseMetadata)})`
          )
        }
        return { content }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          throw new ExternalModelError('Request timed out. The model took too long to respond', 408)
        }
        if (error instanceof ExternalModelError) throw error
        throw new ExternalModelError(error.message || 'Unknown external model error')
      } finally {
        clearTimeout(timeoutId)
      }
    },
  }
}

async function* streamExternalModel(input: ExternalModelCompletionInput, fetchImpl: typeof fetch): AsyncIterable<string> {
  const maxRetries = 3
  let attempt = 0

  while (true) {
    try {
      const normalizedUrl = normalizeBaseUrl(input.model.baseUrl, input.model.format)
      // OpenCode Go keeps a cache per session; a stable id per model lets it reuse the prompt cache.
      const headers = new URL(normalizedUrl).hostname.split('.').slice(-2).join('.') === 'opencode.ai' ? { 'x-opencode-session': `themis-${input.model.id}` } : undefined
      const provider = input.model.format === 'anthropic'
        ? createAnthropic({
          apiKey: input.model.apiKey,
          baseURL: normalizedUrl,
          fetch: fetchImpl,
          headers,
        })
        : createOpenAICompatible({
          name: `themis-${input.model.id}`,
          apiKey: input.model.apiKey,
          baseURL: normalizedUrl,
          fetch: fetchImpl,
          headers,
        })

      const result = streamText({
        model: provider(input.model.modelName as never),
        prompt: input.prompt,
        abortSignal: input.abortSignal,
      })

      // textStream swallows provider errors and reasoning-only replies; read fullStream so the user sees why.
      let sawText = false
      let reasoningChars = 0
      let finishReason = ''
      for await (const part of result.fullStream as AsyncIterable<any>) {
        if (part.type === 'error') throw part.error
        if (part.type === 'reasoning-delta') reasoningChars += (part.text ?? part.delta ?? '').length
        if (part.type === 'finish') finishReason = part.finishReason ?? ''
        const text = part.type === 'text-delta' ? part.text ?? part.textDelta : ''
        if (text) { sawText = true; yield text }
      }
      if (!sawText) throw new ExternalModelError(`The model returned no text (finish reason: ${finishReason || 'unknown'}${reasoningChars ? `, only ${reasoningChars} characters of reasoning` : ''}). Model: ${input.model.modelName}, URL: ${normalizedUrl}`)
      return
    } catch (error: any) {
      attempt++
      const status = error.status || error.statusCode || error.response?.status
      const isRetryable = status === 429 || (status >= 500 && status <= 599) || error.message?.includes('timeout') || error.message?.includes('Network')

      if (!isRetryable || attempt >= maxRetries) {
        throw new ExternalModelError(
          error.message || 'External model request failed',
          status,
          error.code
        )
      }

      const delay = Math.pow(2, attempt) * 500
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}
