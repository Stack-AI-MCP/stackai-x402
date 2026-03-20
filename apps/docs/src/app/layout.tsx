import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Banner, Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'stackai-x402 - HTTP 402 Payments for AI Agents',
    template: '%s | stackai-x402'
  },
  description: 'TypeScript SDK and Gateway for x402 HTTP payments on Stacks Bitcoin L2. Monetize MCP tools and enable AI agents to pay for premium services.',
  applicationName: 'stackai-x402',
  generator: 'Next.js',
  openGraph: {
    siteName: 'stackai-x402',
    locale: 'en_US',
    type: 'website'
  }
}

const banner = (
  <Banner storageKey="x402-launch">
    stackai-x402 - HTTP 402 payments for AI agents on Stacks is live!
  </Banner>
)

const navbar = (
  <Navbar
    logo={
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
          x<span style={{ color: '#F97316' }}>402</span>
        </span>
        <span style={{ fontWeight: 600 }}>Docs</span>
      </span>
    }
    projectLink="https://github.com/aibtcdev/stackai-x402"
  />
)

const footer = (
  <Footer className="flex-col items-center md:items-start">
    <p className="text-sm">
      Built with Nextra. Powered by Stacks Bitcoin L2.
    </p>
    <p className="mt-2 text-xs">
      © {new Date().getFullYear()} aibtc.dev. All rights reserved.
    </p>
  </Footer>
)

interface RootLayoutProps {
  children: ReactNode
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const pageMap = await getPageMap()

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />
      </Head>
      <body>
        <Layout
          banner={banner}
          navbar={navbar}
          footer={footer}
          editLink="Edit this page on GitHub"
          docsRepositoryBase="https://github.com/aibtcdev/stackai-x402/tree/main/apps/docs/src/content"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          pageMap={pageMap}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
