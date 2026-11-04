/**
 * Test helper: the text of a PDF, one string per page, read with pypdf through `uv` (the same
 * route as DS-05's font checks, so CI needs no poppler). DOC-34 §16 names `pdftotext`; pypdf
 * reads the same ToUnicode maps the renderer embeds. Server-side tests only.
 */
const PYPDF_VERSION = '6.21.4'

const SCRIPT = [
  'import io, json, sys',
  'from pypdf import PdfReader',
  'reader = PdfReader(io.BytesIO(sys.stdin.buffer.read()))',
  'json.dump([page.extract_text() or "" for page in reader.pages], sys.stdout, ensure_ascii=False)',
].join('\n')

export async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  const uv = Bun.which('uv')
  if (!uv) throw new Error('extractPdfPages needs uv (DR-237): https://docs.astral.sh/uv/')
  const child = Bun.spawn(
    [
      uv,
      'run',
      '--no-project',
      '--quiet',
      '--with',
      `pypdf==${PYPDF_VERSION}`,
      'python',
      '-I',
      '-c',
      SCRIPT,
    ],
    { stdin: new Blob([bytes]), stdout: 'pipe', stderr: 'pipe' },
  )
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`extractPdfPages: exit ${code}: ${err}`)
  return JSON.parse(out) as string[]
}

/** The whole text of a PDF, pages joined by a newline. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  return (await extractPdfPages(bytes)).join('\n')
}
