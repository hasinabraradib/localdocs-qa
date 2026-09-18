// Smoke test: prove the QVAC SDK is installed and that generation works
// offline on this machine. Run with `npm run check`.
import { completion, unloadModel } from '@qvac/sdk'
import { LLM_MODEL, loadWithProgress } from './models.js'

let modelId

try {
  modelId = await loadWithProgress(LLM_MODEL, 'chat model')

  const run = completion({
    modelId,
    history: [{ role: 'user', content: 'Say hello in one short sentence.' }],
    stream: true
  })

  for await (const event of run.events) {
    if (event.type === 'contentDelta') process.stdout.write(event.text)
  }

  process.stdout.write('\n')

  await unloadModel({ modelId })
  console.error('▸ Check passed: the model ran locally.')
} catch (error) {
  console.error(`\n✖ Check failed: ${error?.message ?? error}`)
  console.error('  Make sure you have network access for the first model download,')
  console.error('  plus a few GB of free disk space for the cached weights.')
  process.exit(1)
}
