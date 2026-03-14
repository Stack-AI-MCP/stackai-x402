import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Host_Grotesk } from 'next/font/google'
import { Toaster } from 'sonner'
import { Providers } from './providers'
import { GlobalNavbar } from '@/components/layout/navbar'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
const hostGrotesk = Host_Grotesk({ subsets: ['latin'], variable: '--font-host-grotesk' })

export const metadata: Metadata = {
  title: 'StacksAI x402 — Molbot Commerce',
  description: 'Browse, register, and monetize MCP servers with x402 payments on Stacks. STX, sBTC, and USDCx.',
  metadataBase: new URL('https://x402.stacksai.app'),
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* FOUC prevention — inline theme detection before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geist.variable} ${geistMono.variable} ${hostGrotesk.variable} font-sans antialiased bg-background text-foreground`}
      >
        <Providers>
          <GlobalNavbar />
          <main>
            {children}
          </main>
          <Toaster richColors position="bottom-right" />
        </Providers>
      </body>
    </html>
  )
}
