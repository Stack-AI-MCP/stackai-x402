# stackai-x402 Documentation

This is the documentation site for stackai-x402, built with [Nextra 4](https://nextra.site).

## Development

Install dependencies:
```bash
pnpm install
```

Start the development server:
```bash
pnpm dev
```

The documentation will be available at `http://localhost:3003`.

## Structure

- `src/app`: Next.js App Router configuration and layout.
- `src/content`: MDX documentation files.
- `src/content/_meta.ts`: Sidebar navigation configuration.
- `public`: Static assets (images, etc.).

## Adding Pages

1. Create a new `.mdx` file in `src/content`.
2. Add the page to `src/content/_meta.ts` to show it in the sidebar.
