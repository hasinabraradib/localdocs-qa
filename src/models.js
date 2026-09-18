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
  let shown = false
  let lastPercent = -1

  const modelId = await loadModel({
    modelSrc,
    ...(modelConfig ? { modelConfig } : {}),
    onProgress: (p) => {
      // Round down: at 99.9% the download is not finished, and showing "100%"
      // early makes every remaining update look like a duplicate line.
      const percent = Math.floor(p.percentage)
      const size = Number.isFinite(p.total) && p.total > 0
        ? ` (${megabytes(p.downloaded)}/${megabytes(p.total)} MB)`
        : ''
      const line = `▸ Loading ${label} ${percent}%${size}`

      if (process.stderr.isTTY) {
        process.stderr.write(`\r${line}`)
      } else if (percent !== lastPercent) {
        // Without a TTY each update would be its own line, so only log when the
        // whole percent actually moves.
        process.stderr.write(`${line}\n`)
      }

      shown = true
      lastPercent = percent
    }
  })

  // Close the progress line once loading is done. Doing this here rather than
  // inside the callback also covers sources that never report a final 100%,
  // such as a model already cached on disk.
  if (shown && process.stderr.isTTY) process.stderr.write('\n')

  return modelId
}
