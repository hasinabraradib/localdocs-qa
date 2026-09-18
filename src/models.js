// Model choices for localdocs-qa, plus a shared loader that reports download
// progress. Both models run entirely on-device: the SDK fetches the weights
// once from the QVAC registry, then every inference happens locally.
import { loadModel, GTE_LARGE_FP16, LLAMA_3_2_1B_INST_Q4_0 } from '@qvac/sdk'

// Embedding model: turns document chunks and questions into vectors for RAG.
export const EMBED_MODEL = GTE_LARGE_FP16

// Chat model: writes the final answer from the retrieved chunks.
export const LLM_MODEL = LLAMA_3_2_1B_INST_Q4_0

const megabytes = (bytes) => (bytes / 1e6).toFixed(1)

/**
 * Load a model and render a single self-updating progress line on stderr,
 * so piping stdout to a file still gives clean output.
 *
 * @param {string} modelSrc     A model constant, local path, or remote source.
 * @param {string} label        Human-readable name shown in the progress line.
 * @param {object} [modelConfig] Engine-specific settings (e.g. { ctx_size }).
 * @returns {Promise<string>}   The loaded model's id.
 */
export async function loadWithProgress (modelSrc, label, modelConfig) {
  let finished = false

  const modelId = await loadModel({
    modelSrc,
    ...(modelConfig ? { modelConfig } : {}),
    onProgress: (p) => {
      // The SDK keeps emitting updates after the last byte lands; report 100%
      // once so piped (non-TTY) logs don't fill up with identical lines.
      if (finished) return

      const size = Number.isFinite(p.total) && p.total > 0
        ? ` (${megabytes(p.downloaded)}/${megabytes(p.total)} MB)`
        : ''
      const line = `▸ Loading ${label} ${p.percentage.toFixed(0)}%${size}`

      process.stderr.write(process.stderr.isTTY ? `\r${line}` : `${line}\n`)

      if (p.percentage >= 100) {
        finished = true
        if (process.stderr.isTTY) process.stderr.write('\n')
      }
    }
  })

  return modelId
}
