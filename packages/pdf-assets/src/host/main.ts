import type { DocumentProps } from '@react-pdf/renderer'
import { renderToBuffer } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { registerFonts } from '../fonts'
import type { RenderRequest, RenderResponse } from './protocol'

/**
 * One document kind: a factory that turns its input into the root `<Document>` element
 * (DOC-34 §4.1, DR-291).
 */
export type RenderTemplates = Record<string, (input: unknown) => ReactElement<DocumentProps>>

/**
 * The render host's entry point (DOC-34 §4.1, §10, DR-291). It registers the fonts once,
 * loads the templates module named by `argv[2]`, then answers every {@link RenderRequest} with
 * `renderToBuffer`. A failed render is reported on the channel and never takes the host down.
 */
export function runRenderHost(templatesModule: string): void {
  registerFonts()
  const templates = import(templatesModule).then(
    (module) => (module as { default: RenderTemplates }).default,
  )
  process.on('message', (message) => {
    void answer(message as RenderRequest, templates)
  })
}

async function answer(request: RenderRequest, templates: Promise<RenderTemplates>): Promise<void> {
  const template = (await templates)[request.kind]
  if (!template) {
    send({ id: request.id, ok: false, message: `unknown kind: ${request.kind}` })
    return
  }
  try {
    const bytes = await renderToBuffer(template(request.input))
    send({ id: request.id, ok: true, bytes, rssBytes: process.memoryUsage().rss })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    send({ id: request.id, ok: false, message })
  }
}

function send(response: RenderResponse): void {
  process.send?.(response)
}

if (import.meta.main) {
  const templatesModule = process.argv[2]
  if (templatesModule) runRenderHost(templatesModule)
  else process.exit(1)
}
