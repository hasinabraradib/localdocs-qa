// Build the local search index for localdocs-qa.
//
// Reads every .md/.txt file under a folder, splits them into overlapping
// chunks, and embeds those chunks into a QVAC RAG workspace stored on this
// machine. Nothing leaves the device: the embedding model runs locally and the
// vectors are written to the SDK's own on-disk workspace.
//
// Usage: node src/ingest.js [folder]   (default ./docs)
import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import {
  ragIngest,
  ragListWorkspaces,
  ragCloseWorkspace,
  ragDeleteWorkspace,
  unloadModel
} from '@qvac/sdk'
import { EMBED_MODEL, loadWithProgress } from './models.js'
import { chunkText } from './chunker.js'

export const WORKSPACE = 'localdocs'

const SUPPORTED = new Set(['.md', '.txt'])

/** Collect .md/.txt files under `dir`, depth first and in a stable order. */
async function collectFiles (dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const found = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Skip dotfiles and dependency folders rather than indexing junk.
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) found.push(...await collectFiles(full))
    else if (SUPPORTED.has(path.extname(entry.name).toLowerCase())) found.push(full)
  }

  return found
}

/**
 * Drop any existing copy of the workspace so a run always reflects the folder
 * as it is now, instead of stacking new vectors on top of stale ones.
 */
async function resetWorkspace () {
  const workspaces = await ragListWorkspaces()
  const existing = workspaces.find((w) => w.name === WORKSPACE)

  if (!existing) return

  // A loaded workspace holds file locks, so it has to be closed before delete.
  if (existing.open) await ragCloseWorkspace({ workspace: WORKSPACE })
  await ragDeleteWorkspace({ workspace: WORKSPACE })

  console.error(`▸ Cleared the previous '${WORKSPACE}' index`)
}

let modelId

try {
  const folder = path.resolve(process.argv[2] ?? './docs')

  let files
  try {
    files = await collectFiles(folder)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    files = []
  }

  if (files.length === 0) {
    console.error(`✖ No .md or .txt files found in ${folder}`)
    console.error('  Put some notes there, or point the script at another folder:')
    console.error('    npm run ingest -- ./path/to/notes')
    process.exit(1)
  }

  // Tag every chunk with its file so answers can cite where they came from.
  const documents = []
  for (const file of files) {
    const relative = path.relative(folder, file)
    const text = await readFile(file, 'utf8')

    for (const chunk of chunkText(text)) {
      documents.push(`[source: ${relative}]\n${chunk}`)
    }
  }

  if (documents.length === 0) {
    console.error(`✖ Found ${files.length} file(s) in ${folder}, but they are all empty.`)
    process.exit(1)
  }

  console.error(`▸ Read ${files.length} file(s) → ${documents.length} chunk(s)`)

  // Reset before loading the model: if something is wrong with the existing
  // workspace, fail now rather than after a model download.
  await resetWorkspace()

  modelId = await loadWithProgress(EMBED_MODEL, 'embedding model')

  const result = await ragIngest({
    modelId,
    workspace: WORKSPACE,
    documents,
    // Our own chunker already did the splitting, and it keeps the [source: ...]
    // tag attached to the text it belongs to.
    chunk: false,
    onProgress: (stage, current, total) => {
      const line = `▸ Indexing [${stage}] ${current}/${total}`
      process.stderr.write(process.stderr.isTTY ? `\r${line}\x1b[K` : `${line}\n`)
    }
  })

  if (process.stderr.isTTY) process.stderr.write('\n')

  console.log(`▸ Files read:      ${files.length}`)
  console.log(`▸ Chunks ingested: ${result.processed.length}`)
  console.log(`▸ Chunks dropped:  ${result.droppedIndices.length}`)
  console.log(`▸ Workspace:       '${WORKSPACE}' (saved on this device)`)

  // Close, don't delete: the vectors stay on disk for the question step.
  await ragCloseWorkspace({ workspace: WORKSPACE })
  await unloadModel({ modelId })
} catch (error) {
  console.error(`\n✖ Ingest failed: ${error?.message ?? error}`)

  if (modelId) {
    // Best effort cleanup so a failed run does not leave the model resident.
    await ragCloseWorkspace({ workspace: WORKSPACE }).catch(() => {})
    await unloadModel({ modelId }).catch(() => {})
  }

  process.exit(1)
}
