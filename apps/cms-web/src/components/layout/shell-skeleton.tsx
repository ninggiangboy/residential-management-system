import { Skeleton } from '../ui/skeleton'
import { BrandMark } from './brand-mark'

/**
 * What the boot shows while the session is restored (DOC-55 §5.1): the frame of `AppShell` with placeholders, so the real shell
 * replaces it in place instead of appearing on a blank page. `#boot` in `index.html` draws the same frame before the scripts
 * run: a change here is made there too (DR-306). Both follow the collapsed sidebar through `nav-full:` (DR-312).
 */
export function ShellSkeleton() {
  return (
    <div className="hidden h-screen overflow-clip md:flex" aria-busy="true">
      <aside className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col nav-full:w-[248px]">
        <div className="flex items-center gap-3 px-[18px] py-4">
          <BrandMark />
          <div className="hidden flex-col gap-1.5 nav-full:flex">
            <Skeleton immediate className="h-4 w-32" />
            <Skeleton immediate className="h-3 w-20" />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 px-3 pt-2">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton immediate key={item} className="h-control-md" />
          ))}
        </div>
        <Skeleton immediate className="m-3 h-13 rounded-card" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="gutter-stable flex h-14 shrink-0 items-center justify-between gap-4 overflow-hidden px-8">
          <div className="flex items-center gap-3">
            {/* The sidebar toggle and its separator (DR-312), so the breadcrumb starts where the real one does. */}
            <div className="hidden items-center gap-3 lg:flex">
              <Skeleton immediate className="size-control-sm" />
              <span className="h-4 w-px bg-line" />
            </div>
            <Skeleton immediate className="h-4 w-40" />
          </div>
          <Skeleton immediate className="h-8 w-56" />
        </header>
        <main className="gutter-stable min-h-0 min-w-0 flex-1 overflow-y-auto px-8 pb-10 pt-6">
          <Skeleton immediate className="h-7 w-56" />
          <Skeleton immediate className="mt-1.5 h-3.5 w-80" />
          <Skeleton immediate className="mt-6 h-96 rounded-card" />
        </main>
      </div>
    </div>
  )
}
