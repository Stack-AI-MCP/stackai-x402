import { TabNav } from '@/components/x402/TabNav'

export default function HomeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Secondary sticky sub-nav — sits directly below the global navbar */}
      <header className="sticky top-12 z-30 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-11 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground hidden sm:block">
            x<span className="text-primary">402</span> Gateway
          </span>
          {/* Desktop tab nav */}
          <div className="hidden md:block">
            <TabNav />
          </div>
          {/* Mobile: show tabs scrollable */}
          <div className="flex md:hidden w-full overflow-x-auto scrollbar-hide">
            <TabNav />
          </div>
        </div>
      </header>

      {/* Page content with consistent max-width + padding */}
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8 pb-24 md:pb-10">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm md:hidden">
        <TabNav mobile />
      </div>
    </div>
  )
}
