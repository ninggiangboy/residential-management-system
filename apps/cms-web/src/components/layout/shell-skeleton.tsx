import { Skeleton } from '../ui/skeleton'

/**
 * What the boot shows while the session is restored (DOC-55 §5.1): the frame of `AppShell` with placeholders, so the real shell
 * replaces it in place instead of appearing on a blank page. `#boot` in `index.html` draws the same frame before the scripts
 * run: a change here is made there too (DR-306).
 */
export function ShellSkeleton() {
  return (
    <div className="hidden h-screen overflow-clip md:flex" aria-busy="true">
      <aside className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col border-r border-line bg-surface lg:w-[248px]">
        <div className="flex flex-col gap-2 px-4 py-5 lg:px-6">
          <Skeleton immediate className="h-5 w-10 lg:w-40" />
          <Skeleton immediate className="hidden h-3.5 w-24 lg:block" />
        </div>
        <div className="flex flex-1 flex-col gap-2 px-3">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton immediate key={item} className="h-control-sm" />
          ))}
        </div>
        <Skeleton immediate className="m-3 h-[60px] rounded-card" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="gutter-stable flex h-16 shrink-0 items-center justify-between gap-4 overflow-hidden border-b border-line bg-surface px-8">
          <Skeleton immediate className="h-4 w-40" />
          <Skeleton immediate className="h-10 w-64 rounded-full" />
        </header>
        <main className="gutter-stable min-h-0 min-w-0 flex-1 overflow-y-auto px-8 pb-10 pt-7">
          <Skeleton immediate className="h-8 w-56" />
          <Skeleton immediate className="mt-2 h-4 w-80" />
          <Skeleton immediate className="mt-8 h-96 rounded-card" />
        </main>
      </div>
    </div>
  )
}
