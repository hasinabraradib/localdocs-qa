// Shared retrieval-and-answer logic for the two front ends (src/ask.js for a
// single question, src/chat.js for a session). Everything here runs against
// models already loaded on this device.
import { completion, ragSearch, ragListWorkspaces } from '@qvac/sdk'

// Kept in step with src/ingest.js. It is duplicated rather than imported
// because importing that module would run the ingest script.
export const WORKSPACE = 'localdocs'

export const TOP_K = 4

// Below this retrieval score we do not ask the model at all.
//
// Measured against the sample docs: in-scope questions scored 0.644-0.842
// (9 questions) and unrelated ones 0.507-0.668 (8 questions). The ranges
// overlap, so no threshold separates them perfectly. 0.60 is the highest cut
// that still clears every in-scope question with margin; it catches the
// plainly unrelated half ("Who won the 2010 World Cup?" at 0.58, "How do I
// bake a cake?" at 0.57) and leaves the near-miss ones to the system prompt,
// which refuses them on its own.
export const MIN_SCORE = 0.6

// The exact sentence the app promises when the documents do not cover the
// question. Kept in one place so the prompt and the rules cannot drift apart.
export const REFUSAL = "I couldn't find that in your documents."

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

// Naming the refusal sentence again here made the model refuse everything,
// including questions the documents plainly answer, so this line only points
// at the context and leaves the branch to the system prompt.
const INSTRUCTION = 'Answer the question using only the text above.'

const RESET = '\x1b[0m'

/** Pull the file name out of the "[source: ...]" prefix ingest added. */
function sourceOf (content) {
  return content.match(/^\[source:\s*(.+?)\]/)?.[1] ?? 'unknown'
}

/** True when ingest has already built the index on this device. */
export async function workspaceExists () {
  const workspaces = await ragListWorkspaces()

  return workspaces.some((w) => w.name === WORKSPACE)
}

/** Nearest passages to the question, best match first. */
export async function searchDocs ({ modelId, question }) {
  return ragSearch({ modelId, workspace: WORKSPACE, query: question, topK: TOP_K })
}

/** The chat turns sent to the model: the rules, the passages, the question. */
export function buildHistory ({ results, question }) {
  const context = results
    .map((result, index) => `[${index + 1}] ${result.content}`)
    .join('\n\n')

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${context}\n\nQuestion: ${question}\n\n${INSTRUCTION}` }
  ]
}

/**
 * Drop markdown heading markers as text streams past, so an answer lifted from
 * a document does not arrive as "## The four Coffman conditions".
 *
 * Deltas can split anywhere, including between the '#' and its text, so the
 * marker is held back character by character and released as soon as it turns
 * out not to be a heading. "#hashtag" survives; only "# " is removed.
 */
export function createHeadingStripper (write) {
  let atLineStart = true
  let held = ''

  return {
    push (text) {
      let out = ''

      for (const char of text) {
        if (atLineStart && char === '#') {
          held += char
          continue
        }

        if (held) {
          // A space after the marker confirms a heading: drop both.
          if (char === ' ') {
            held = ''
            atLineStart = false
            continue
          }

          // Anything else means it was never a heading.
          out += held
          held = ''
        }

        out += char
        atLineStart = char === '\n'
      }

      if (out) write(out)
    },

    end () {
      if (held) write(held)
      held = ''
    }
  }
}

/** Stream one answer, returning the text that was actually written. */
export async function streamAnswer ({ modelId, history, write = (t) => process.stdout.write(t) }) {
  let answer = ''

  const stripper = createHeadingStripper((text) => {
    answer += text
    write(text)
  })

  const run = completion({ modelId, history, stream: true })

  for await (const event of run.events) {
    if (event.type === 'contentDelta') stripper.push(event.text)
  }

  stripper.end()
  write('\n')

  return answer
}

/**
 * One line per file, in retrieval order, showing the score of that file's
 * best-matching passage. Results arrive ranked, so the first hit for a file is
 * its best one. `color` is an ANSI prefix; the default prints unstyled.
 */
export function printSources (results, { color = '' } = {}) {
  const best = new Map()

  for (const result of results) {
    const file = sourceOf(result.content)
    if (!best.has(file)) best.set(file, result.score)
  }

  const body = ['Sources', ...[...best].map(([file, score]) => `  • ${file} (score ${score.toFixed(2)})`)]
    .join('\n')

  console.log(`\n${color ? `${color}${body}${RESET}` : body}`)
}

/**
 * Search, decide whether the documents are relevant at all, and answer.
 *
 * Returns 'empty' when the index gave nothing back, 'below-threshold' when the
 * best match was too weak to be worth a completion, or 'answered'.
 */
export async function answerQuestion ({ embedModelId, llmModelId, question, sourceColor = '' }) {
  const results = await searchDocs({ modelId: embedModelId, question })

  if (results.length === 0) return { status: 'empty', results }

  // Nothing in the documents is close enough, so skip the model entirely: it
  // is faster and it cannot be talked into answering from memory.
  if (results[0].score < MIN_SCORE) {
    console.log(REFUSAL)
    return { status: 'below-threshold', results }
  }

  const history = buildHistory({ results, question })
  await streamAnswer({ modelId: llmModelId, history })
  printSources(results, { color: sourceColor })

  return { status: 'answered', results }
}
