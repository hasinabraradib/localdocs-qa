// Answer a question from the local index built by src/ingest.js.
//
// Retrieval and generation both happen on this machine: the embedding model
// turns the question into a vector, the RAG workspace on disk supplies the
// matching passages, and the local LLM writes the answer from those passages
// alone.
//
// Usage: node src/ask.js "your question"
import {
  close,
  completion,
  ragSearch,
  ragListWorkspaces,
  ragCloseWorkspace,
  unloadModel
} from '@qvac/sdk'
import { EMBED_MODEL, LLM_MODEL, loadWithProgress } from './models.js'

// Kept in step with src/ingest.js. It is duplicated rather than imported
// because importing that module would run the ingest script.
const WORKSPACE = 'localdocs'

const TOP_K = 4

// The exact sentence the app promises when the documents do not cover the
// question. Kept in one place so the prompt and the rules cannot drift apart.
const REFUSAL = "I couldn't find that in your documents."

// Tuned against this 1B model. Two things were measured, not guessed: stating
// the answer/refuse branch up front keeps it from reciting outside knowledge,
// and banning "describe what is missing" is what produces the exact sentence
// instead of a paraphrase like "that is not mentioned in the text".
const SYSTEM_PROMPT = [
  "You answer questions using ONLY the provided context from the user's own documents.",
  `If the context contains the answer, give it. If it does not, your whole reply must be exactly: ${REFUSAL}`,
  '',
  'Rules:',
  '- Never answer from your own knowledge, even if you are certain of the answer.',
  '- Be concise and clear, and write in plain sentences.',
  "- Do not mention the context or the word 'chunk'.",
  '- Never repeat the [1], [2] labels or the [source: ...] tags that appear in the context.',
  `- Never describe what is missing. Either answer from the context, or reply exactly: ${REFUSAL}`
].join('\n')

let embedModelId
let llmModelId

/** Pull the file name out of the "[source: ...]" prefix ingest added. */
function sourceOf (content) {
  return content.match(/^\[source:\s*(.+?)\]/)?.[1] ?? 'unknown'
}

/**
 * One line per file, in retrieval order, showing the score of that file's
 * best-matching passage. Results arrive ranked, so the first hit for a file is
 * its best one.
 */
function printSources (results) {
  const best = new Map()

  for (const result of results) {
    const file = sourceOf(result.content)
    if (!best.has(file)) best.set(file, result.score)
  }

  console.log('\nSources')
  for (const [file, score] of best) {
    console.log(`  • ${file} (score ${score.toFixed(2)})`)
  }
}

async function main () {
  const question = process.argv.slice(2).join(' ').trim()

  if (!question) {
    console.error('✖ Please pass a question.')
    console.error('  Usage: npm run ask "your question"')
    return 1
  }

  // Check the index before paying for a model load.
  const workspaces = await ragListWorkspaces()
  if (!workspaces.some((w) => w.name === WORKSPACE)) {
    console.error(`✖ No '${WORKSPACE}' index found on this device.`)
    console.error('  Build it first with: npm run ingest')
    return 1
  }

  embedModelId = await loadWithProgress(EMBED_MODEL, 'embedding model')
  // temp: 0 is greedy decoding. At the engine default (0.8) the same question
  // flips between a good answer and a refusal from run to run, which makes the
  // grounding rules untestable.
  llmModelId = await loadWithProgress(LLM_MODEL, 'language model', { ctx_size: 4096, temp: 0 })

  const results = await ragSearch({
    modelId: embedModelId,
    workspace: WORKSPACE,
    query: question,
    topK: TOP_K
  })

  if (results.length === 0) {
    console.error('✖ Nothing in the index matched that question.')
    console.error('  If you have added or changed documents, re-run: npm run ingest')
    return 1
  }

  const context = results
    .map((result, index) => `[${index + 1}] ${result.content}`)
    .join('\n\n')

  // Naming the refusal sentence again here made the model refuse everything,
  // including questions the documents plainly answer, so this line only points
  // at the context and leaves the branch to the system prompt.
  const instruction = 'Answer the question using only the text above.'

  const history = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${context}\n\nQuestion: ${question}\n\n${instruction}` }
  ]

  const run = completion({ modelId: llmModelId, history, stream: true })

  for await (const event of run.events) {
    if (event.type === 'contentDelta') process.stdout.write(event.text)
  }

  process.stdout.write('\n')
  printSources(results)

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
