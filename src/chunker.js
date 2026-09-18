// Text splitting for localdocs-qa.
//
// RAG retrieval works best when a chunk is small enough to be "about" one
// thing, but still carries enough surrounding text to stand on its own. We
// split on paragraph boundaries first and only cut mid-paragraph when a single
// paragraph is longer than the target size, so most chunks end where the
// author already ended a thought. Consecutive chunks share a short overlap so a
// fact that straddles a boundary still appears whole in at least one chunk.

const DEFAULT_SIZE = 800
const DEFAULT_OVERLAP = 150

/**
 * Break a paragraph that is longer than `size` into sentence-sized pieces,
 * falling back to a hard cut for text with no sentence punctuation.
 */
function splitLongBlock (block, size) {
  const sentences = block.split(/(?<=[.!?])\s+/)
  const pieces = []

  for (const sentence of sentences) {
    if (sentence.length <= size) {
      if (sentence.trim()) pieces.push(sentence.trim())
      continue
    }

    // Still too long (e.g. a giant table row or a URL dump): cut at the last
    // whitespace before the limit so we do not slice through a word.
    let rest = sentence.trim()
    while (rest.length > size) {
      const window = rest.slice(0, size)
      const breakAt = window.lastIndexOf(' ')
      const cut = breakAt > size * 0.5 ? breakAt : size
      pieces.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    if (rest) pieces.push(rest)
  }

  return pieces
}

/**
 * Take roughly `overlap` characters from the end of a chunk, starting at a word
 * boundary, to prepend to the next chunk.
 */
function tailOverlap (text, overlap) {
  if (overlap <= 0 || !text) return ''

  const tail = text.slice(-overlap)
  const boundary = tail.search(/\s/)

  return boundary === -1 ? tail : tail.slice(boundary + 1)
}

/**
 * Split a document into overlapping chunks, preferring paragraph boundaries.
 *
 * @param {string} text        The document contents.
 * @param {object} [options]
 * @param {number} [options.size=800]     Target chunk length in characters.
 * @param {number} [options.overlap=150]  Characters shared with the next chunk.
 * @returns {string[]} Chunks in document order; empty if there is no text.
 */
export function chunkText (text, options = {}) {
  const size = options.size ?? DEFAULT_SIZE
  // An overlap at or above the chunk size would never let a chunk advance.
  const overlap = Math.min(options.overlap ?? DEFAULT_OVERLAP, Math.floor(size / 2))

  const normalized = (text ?? '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const blocks = normalized
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    // Leave room for the overlap carried in from the previous chunk, so a
    // packed chunk stays near `size` instead of size + overlap.
    .flatMap((block) => (block.length > size ? splitLongBlock(block, size - overlap) : [block]))

  const chunks = []
  let current = ''

  for (const block of blocks) {
    if (!current) {
      current = block
      continue
    }

    const joined = `${current}\n\n${block}`
    if (joined.length <= size) {
      current = joined
      continue
    }

    chunks.push(current)

    const carry = tailOverlap(current, overlap)
    current = carry ? `${carry}\n\n${block}` : block
  }

  if (current) chunks.push(current)

  return chunks
}
