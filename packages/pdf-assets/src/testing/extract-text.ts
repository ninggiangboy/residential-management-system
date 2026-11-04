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

/** One run of text with its position on the page, in PDF points from the top-left corner. */
export interface PdfTextItem {
  page: number
  text: string
  x: number
  y: number
}

const ITEMS_SCRIPT = [
  'import io, json, sys',
  'from pypdf import PdfReader',
  'reader = PdfReader(io.BytesIO(sys.stdin.buffer.read()))',
  'items = []',
  'for number, page in enumerate(reader.pages, start=1):',
  '    height = float(page.mediabox.height)',
  '    def visit(text, cm, tm, font_dict, font_size, number=number, height=height):',
  '        if text.strip():',
  '            a = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]',
  '            b = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]',
  '            items.append({"page": number, "text": text, "x": a, "y": height - b})',
  '    page.extract_text(visitor_text=visit)',
  'json.dump(items, sys.stdout, ensure_ascii=False)',
].join('\n')

/** Every text run of a PDF with its page and position, for layout assertions (for example that a footer is on the page). */
export async function extractPdfTextItems(bytes: Uint8Array): Promise<PdfTextItem[]> {
  const uv = Bun.which('uv')
  if (!uv) throw new Error('extractPdfTextItems needs uv (DR-237): https://docs.astral.sh/uv/')
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
      ITEMS_SCRIPT,
    ],
    { stdin: new Blob([bytes]), stdout: 'pipe', stderr: 'pipe' },
  )
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`extractPdfTextItems: exit ${code}: ${err}`)
  return JSON.parse(out) as PdfTextItem[]
}
