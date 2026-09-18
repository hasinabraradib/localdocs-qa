// Interactive session over the local index built by src/ingest.js.
//
// Same retrieval and answering as src/ask.js, but the two models are loaded
// once and reused for every question, so only the first answer pays the load
// cost. Nothing is sent anywhere: both models run on this device.
//
// Usage: node src/chat.js
import readline from 'node:readline/promises'
import { close, ragCloseWorkspace, unloadModel } from '@qvac/sdk'
import { EMBED_MODEL, LLM_MODEL, loadWithProgress } from './models.js'
import { WORKSPACE, answerQuestion, workspaceExists } from './rag.js'

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GRAY = '\x1b[90m'
const RESET = '\x1b[0m'

const PROMPT = 'Ask about your docs (type exit to quit): '
const QUIT_WORDS = new Set(['exit', 'quit'])

let embedModelId
let llmModelId

async function main () {
  console.log(`${BOLD}localdocs-qa · 100% on-device · powered by QVAC${RESET}`)

  // Check the index before paying for a model load.
  if (!await workspaceExists()) {
    console.error(`✖ No '${WORKSPACE}' index found on this device.`)
    console.error('  Build it first with: npm run ingest')
    return 1
  }

  embedModelId = await loadWithProgress(EMBED_MODEL, 'embedding model')
  // temp: 0 is greedy decoding. At the engine default (0.8) the same question
  // flips between a good answer and a refusal from run to run.
  llmModelId = await loadWithProgress(LLM_MODEL, 'language model', { ctx_size: 4096, temp: 0 })

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  // Ctrl+C ends the line stream, which leaves the loop and falls through to
  // the same cleanup as typing "exit".
  rl.on('SIGINT', () => rl.close())

  // Iterating the interface rather than awaiting rl.question() in a loop:
  // question() reads one line and drops whatever else already arrived, so a
  // piped session would answer the first question and quit.
  const ask = () => process.stdout.write(`\n${PROMPT}`)

  try {
    ask()

    for await (const line of rl) {
      const question = line.trim()

      if (!question) {
        ask()
        continue
      }

      if (QUIT_WORDS.has(question.toLowerCase())) break

      const startedAt = Date.now()
      const { status } = await answerQuestion({
        embedModelId,
        llmModelId,
        question,
        sourceColor: GRAY
      })

      if (status === 'empty') {
        console.error('✖ Nothing in the index matched that question.')
        console.error('  If you have added or changed documents, re-run: npm run ingest')
      } else {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
        console.log(`${DIM}(${seconds}s)${RESET}`)
      }

      ask()
    }
  } finally {
    rl.close()
  }

  console.log('\nBye.')

  return 0
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`\n✖ Chat stopped: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  // Runs however the session ended — "exit", Ctrl+C, or a crash — so the
  // models never stay resident. The index stays on disk.
  if (embedModelId || llmModelId) {
    await ragCloseWorkspace({ workspace: WORKSPACE }).catch(() => {})

    for (const modelId of [embedModelId, llmModelId]) {
      if (modelId) await unloadModel({ modelId }).catch(() => {})
    }
  }

  // close() is the documented teardown and is the one call that never starts
  // the worker, so it is safe even when we bailed out before loading anything.
  await close().catch(() => {})
}
