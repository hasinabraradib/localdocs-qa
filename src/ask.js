// Answer a single question from the local index built by src/ingest.js.
//
// Retrieval and generation both happen on this machine: the embedding model
// turns the question into a vector, the RAG workspace on disk supplies the
// matching passages, and the local LLM writes the answer from those passages
// alone.
//
// Usage: node src/ask.js "your question"
import { close, ragCloseWorkspace, unloadModel } from '@qvac/sdk'
import { EMBED_MODEL, LLM_MODEL, loadWithProgress } from './models.js'
import { WORKSPACE, answerQuestion, workspaceExists } from './rag.js'

let embedModelId
let llmModelId

async function main () {
  const question = process.argv.slice(2).join(' ').trim()

  if (!question) {
    console.error('✖ Please pass a question.')
    console.error('  Usage: npm run ask "your question"')
    return 1
  }

  // Check the index before paying for a model load.
  if (!await workspaceExists()) {
    console.error(`✖ No '${WORKSPACE}' index found on this device.`)
    console.error('  Build it first with: npm run ingest')
    return 1
  }

  embedModelId = await loadWithProgress(EMBED_MODEL, 'embedding model')
  // temp: 0 is greedy decoding. At the engine default (0.8) the same question
  // flips between a good answer and a refusal from run to run, which makes the
  // grounding rules untestable.
  llmModelId = await loadWithProgress(LLM_MODEL, 'language model', { ctx_size: 4096, temp: 0 })

  const { status } = await answerQuestion({ embedModelId, llmModelId, question })

  if (status === 'empty') {
    console.error('✖ Nothing in the index matched that question.')
    console.error('  If you have added or changed documents, re-run: npm run ingest')
    return 1
  }

  return 0
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`\n✖ Could not answer that: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  // Runs on both the happy path and on failure, so a crash never leaves the
  // models resident or the workspace locked. The data stays on disk.
  //
  // Only touch the workspace if a model was actually loaded: on the usage and
  // missing-index paths the SDK worker may never have started, and calling in
  // would spawn it purely to shut it down.
  if (embedModelId || llmModelId) {
    await ragCloseWorkspace({ workspace: WORKSPACE }).catch(() => {})

    for (const modelId of [embedModelId, llmModelId]) {
      if (modelId) await unloadModel({ modelId }).catch(() => {})
    }
  }

  // Shut down the background worker so the process can exit. close() is the
  // documented teardown and is the one call that never starts the worker, so
  // it is safe even when we bailed out before loading anything.
  await close().catch(() => {})
}
