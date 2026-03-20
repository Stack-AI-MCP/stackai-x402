/**
 * Moltbook verification challenge solver.
 * Ported from docs/moltbook-mcp/components/moltbook-core.js (lines 17-174).
 *
 * When creating posts/comments, the API may return a verification_code + challenge
 * (an obfuscated math expression using word numbers). We parse, evaluate, and POST
 * the answer to /api/v1/verify.
 */

import { execSync } from 'node:child_process'
import type { ChallengeResult } from '../types.js'
import { logger } from '../logger.js'

const log = logger.child('challenge')
const MOLTBOOK_API_BASE = 'https://www.moltbook.com/api/v1'

/**
 * POST to Moltbook API via curl subprocess.
 *
 * Node.js's built-in fetch (undici) has a TLS fingerprint (JA3/JA4) that
 * Moltbook's CDN WAF blocks on POST requests with JSON body. GET and
 * bodyless POST (upvotes) pass through, but comments/posts return 403 HTML.
 *
 * curl has a standard TLS fingerprint that WAFs almost never block.
 * The reference moltbook-mcp has the same issue (BRIEFING.md: "Bluesky blocked (403)")
 * and their retryWithoutAuth only works for GET.
 */
async function moltbookPost(url: string, apiKey: string, data: unknown): Promise<Record<string, unknown>> {
  // Defense-in-depth: validate inputs before shell interpolation in execSync.
  // Both values come from trusted sources (MOLTBOOK_API_BASE constant + Redis config),
  // but we guard against future code paths passing unsanitized input.
  if (!url.startsWith(MOLTBOOK_API_BASE)) {
    throw new Error(`moltbookPost: url must start with ${MOLTBOOK_API_BASE}, got: ${url.slice(0, 80)}`)
  }
  if (!/^moltbook_[a-zA-Z0-9_-]+$/.test(apiKey)) {
    throw new Error('moltbookPost: apiKey must match pattern moltbook_[a-zA-Z0-9_-]+')
  }

  const jsonBody = JSON.stringify(data)
  log.info('moltbookPost', { url, bodyLength: jsonBody.length })

  // 403 diagnostic framework (from Moltbook community):
  //   <100ms  = edge rejection (IP/ASN blocklist) — retry is pointless
  //   100-500ms = bot detection scoring — fingerprint change might help
  //   500ms+  = application-level block — rate limit, fixable
  // We only retry application-level blocks (500ms+). Edge rejections get 1 retry
  // with a long delay (CDN state may rotate), but not 3 wasted attempts.
  const MAX_RETRIES = 2
  const RETRY_DELAYS = [3_000, 8_000]

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Capture response time + status + body size for 403 diagnostics
      const result = execSync(
        `curl -s -w "\\n%{time_total}\\n%{size_download}\\n%{http_code}" -X POST "${url}" ` +
        `-H "Content-Type: application/json" ` +
        `-H "Authorization: Bearer ${apiKey}" ` +
        `--data-binary @-`,
        {
          input: jsonBody,
          timeout: 30_000,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
        },
      )

      const lines = result.trimEnd().split('\n')
      const statusCode = parseInt(lines.pop()!, 10)
      const bodySize = parseInt(lines.pop()!, 10)
      const responseTimeSec = parseFloat(lines.pop()!)
      const responseTimeMs = Math.round(responseTimeSec * 1000)
      const body = lines.join('\n')

      if (!body.startsWith('{') && !body.startsWith('[')) {
        // Diagnose the 403 layer
        const layer = responseTimeMs < 100 ? 'edge'
          : responseTimeMs < 500 ? 'challenge'
          : 'application'

        log.warn('moltbookPost blocked', {
          statusCode,
          responseTimeMs,
          bodySize,
          layer,
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          // Log first 300 chars of response body to understand what the server is saying
          responsePreview: body.slice(0, 300),
        })

        // Edge rejections (<100ms): retry once with long delay (CDN rotation),
        // but don't waste all retries — the IP itself is the problem.
        if (layer === 'edge' && attempt >= 1) {
          throw new Error(`${statusCode} edge rejection (${responseTimeMs}ms) — IP/ASN blocked`)
        }

        // After first curl failure, try fetch as fallback (reference moltFetch uses fetch).
        // The server may accept fetch's request format but reject curl's.
        if (attempt === 1 && layer === 'application') {
          log.info('moltbookPost trying fetch fallback')
          try {
            const fetchResult = await moltbookPostFetch(url, apiKey, data)
            if (fetchResult) return fetchResult
          } catch (fetchErr) {
            log.warn('moltbookPost fetch fallback failed', { error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) })
          }
        }

        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
          continue
        }
        throw new Error(`${statusCode} ${layer} block (${responseTimeMs}ms, ${bodySize}B): ${body.slice(0, 200)}`)
      }

      const parsed = JSON.parse(body) as Record<string, unknown>
      log.info('moltbookPost response', {
        statusCode,
        responseTimeMs,
        keys: Object.keys(parsed),
        ...(attempt > 0 ? { retriedAfter: attempt } : {}),
      })
      return parsed
    } catch (err) {
      if (err instanceof Error && 'stdout' in err) {
        const stdout = (err as { stdout?: string }).stdout ?? ''
        if (attempt < MAX_RETRIES) {
          log.warn('moltbookPost curl error, retrying', { attempt: attempt + 1 })
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
          continue
        }
        throw new Error(`curl failed: ${err.message.slice(0, 100)}, stdout: ${stdout.slice(0, 200)}`)
      }
      throw err
    }
  }

  throw new Error('moltbookPost: unreachable')
}

/**
 * Fetch-based fallback for POST requests. Matches the reference moltFetch exactly:
 * only Content-Type + Authorization, no extra headers, plain fetch.
 */
async function moltbookPostFetch(url: string, apiKey: string, data: unknown): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const startMs = Date.now()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    })
    const responseTimeMs = Date.now() - startMs
    clearTimeout(timer)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      log.warn('moltbookPostFetch failed', { status: response.status, responseTimeMs, bodyPreview: text.slice(0, 200) })
      return null
    }

    const json = await response.json() as Record<string, unknown>
    log.info('moltbookPostFetch success', { status: response.status, responseTimeMs, keys: Object.keys(json) })
    return json
  } catch (err) {
    clearTimeout(timer)
    log.warn('moltbookPostFetch error', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

// ─── Word-to-math converter ─────────────────────────────────────────────────

const numberWords: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, million: 1000000,
}

const opWords: Record<string, string> = {
  plus: '+', and: '+', add: '+', added: '+', adds: '+',
  minus: '-', subtract: '-', subtracted: '-', subtracts: '-',
  reduces: '-', reduce: '-', less: '-', decreased: '-',
  slows: '-', loses: '-', drops: '-', falls: '-',
  gains: '+', increases: '+', grows: '+', rises: '+',
  times: '*', multiplied: '*', multiply: '*', multiplies: '*',
  divided: '/', divide: '/', divides: '/', over: '/',
  'raised to': '**', 'to the power of': '**',
}

/**
 * Try to match a (possibly obfuscated) token against a dictionary.
 * Moltbook doubles characters: "three" → "thrree", "twenty" → "twweenttyy".
 * We try: direct match → single-pair removal → full dedup.
 * Returns the matched dictionary key or undefined.
 */
function fuzzyDictMatch(token: string, dict: Record<string, unknown>): string | undefined {
  // 1. Direct match
  if (token in dict) return token

  // 2. Try removing one doubled pair at a time (handles "thrree" → "three")
  for (let i = 0; i < token.length - 1; i++) {
    if (token[i] === token[i + 1]) {
      const candidate = token.slice(0, i) + token.slice(i + 1)
      if (candidate in dict) return candidate
    }
  }

  // 3. Full dedup — collapse all consecutive pairs (handles "twweenttyy" → "twenty")
  const deduped = token.replace(/(.)\1/g, '$1')
  if (deduped !== token && deduped in dict) return deduped

  // 4. Full dedup + single-pair removal (handles "thhhhreeee" → "thre" → "three")
  if (deduped !== token) {
    for (let i = 0; i < deduped.length - 1; i++) {
      if (deduped[i] === deduped[i + 1]) {
        const candidate = deduped.slice(0, i) + deduped.slice(i + 1)
        if (candidate in dict) return candidate
      }
    }
  }

  return undefined
}

/** All dictionaries for fuzzy matching during token merging */
const allDicts = [numberWords, opWords] as const

/**
 * Rejoin tokens that were split by obfuscation: "thir" + "ty" → "thirty", "tw" + "o" → "two".
 * Also handles operator-separated splits: "tw" + "/" + "o" → "two" (skips noise operators).
 * Tries merging up to 3 adjacent alpha tokens and checks against number/operator dictionaries.
 */
function rejoinSplitTokens(tokens: string[]): string[] {
  const merged: string[] = []
  let i = 0

  while (i < tokens.length) {
    // Only attempt merging from alpha tokens. Operators and digits pass through
    // so real operators like "*" don't get consumed as noise during merge scans.
    if (!/^[a-z]+$/.test(tokens[i])) {
      merged.push(tokens[i])
      i++
      continue
    }

    let found = false

    // Try merging 2-4 adjacent tokens, skipping noise operators between them.
    // "tw" + "/" + "o" → try "two" (skip the "/")
    for (const maxLookahead of [4, 3, 2]) {
      if (found) break
      const end = Math.min(i + maxLookahead, tokens.length)
      // Collect alpha-only tokens in this window, skipping single-char operators
      const alphaTokens: string[] = []
      const consumed: number[] = []
      for (let j = i; j < end; j++) {
        if (/^[a-z]+$/.test(tokens[j])) {
          alphaTokens.push(tokens[j])
          consumed.push(j)
        } else if (/^[+\-*/^]$/.test(tokens[j])) {
          consumed.push(j) // noise operator — consumed but not merged
        } else {
          break // digit or paren — stop expanding
        }
      }
      if (alphaTokens.length >= 2) {
        const combined = alphaTokens.join('')
        for (const dict of allDicts) {
          const match = fuzzyDictMatch(combined, dict)
          if (match) {
            merged.push(match)
            i = consumed[consumed.length - 1] + 1
            found = true
            break
          }
        }
      }
    }

    if (!found) {
      merged.push(tokens[i])
      i++
    }
  }

  return merged
}

/**
 * Convert word-based number/operator tokens to digits/symbols.
 * Handles mixed-case words like "ThIrTy TwO NeWtOnS aNd SeVeN".
 */
export function wordsToMath(text: string): string {
  // Step 1: Rejoin words broken by obfuscation punctuation.
  // Moltbook inserts dots, brackets, carets, etc. WITHIN words:
  //   "TwEl.Ve" → "TwElVe" (twelve), "ThIr.Ty" → "ThIrTy" (thirty)
  let cleaned = text.replace(/(?<=[a-zA-Z])[^a-zA-Z0-9\s]+(?=[a-zA-Z])/g, '')

  // Step 2: Normalize case and strip remaining non-alpha/digit/operator/space chars
  let normalized = cleaned.toLowerCase().replace(/[^a-z0-9+\-*/().^ ]/g, ' ')

  // Ensure operators stuck to words get separated: "newtons+" → "newtons +"
  normalized = normalized.replace(/([a-z])([+\-*/^])/g, '$1 $2').replace(/([+\-*/^])([a-z])/g, '$1 $2')
  // Separate parentheses from adjacent tokens: "(10" → "( 10", "5)" → "5 )"
  normalized = normalized.replace(/([()])/g, ' $1 ')
  normalized = normalized.replace(/\s+/g, ' ').trim()

  // Replace multi-word operators first
  for (const [phrase, op] of Object.entries(opWords)) {
    if (phrase.includes(' ')) {
      normalized = normalized.replace(new RegExp(phrase, 'g'), ` ${op} `)
    }
  }

  // Rejoin tokens split by obfuscation: "thir" + "ty" → "thirty", "tw" + "o" → "two"
  const rawTokens = normalized.split(/\s+/)
  const tokens = rejoinSplitTokens(rawTokens)
  const result: string[] = []
  let currentNumber: number | null = null
  let lastWasMultiplier = false
  let pendingSmall: number | null = null

  function flushNumber(): void {
    if (pendingSmall !== null) {
      currentNumber = (currentNumber || 0) + pendingSmall
      pendingSmall = null
    }
    if (currentNumber !== null) {
      result.push(String(currentNumber))
      currentNumber = null
      lastWasMultiplier = false
    }
  }

  for (const token of tokens) {
    const numMatch = fuzzyDictMatch(token, numberWords)
    const opMatch = !numMatch ? fuzzyDictMatch(token, opWords) : undefined

    if (numMatch) {
      const val = numberWords[numMatch]
      if (val === 100 || val === 1000 || val === 1000000) {
        if (pendingSmall !== null) {
          currentNumber = (currentNumber || 0) + pendingSmall * val
          pendingSmall = null
        } else if (currentNumber !== null && currentNumber > 0 && currentNumber < val) {
          currentNumber *= val
        } else if (currentNumber !== null && currentNumber >= val) {
          currentNumber += val
        } else {
          currentNumber = val
        }
        lastWasMultiplier = true
      } else if (lastWasMultiplier && val < 100) {
        if (pendingSmall !== null) {
          currentNumber = (currentNumber || 0) + pendingSmall
        }
        pendingSmall = val
      } else if (currentNumber !== null && val < 10 && (currentNumber % 100 >= 20 || (pendingSmall !== null && pendingSmall >= 20))) {
        if (pendingSmall !== null && pendingSmall >= 20) {
          pendingSmall += val
        } else {
          currentNumber += val
        }
        lastWasMultiplier = false
      } else if (currentNumber !== null && val >= 20 && currentNumber % 1000 >= 100) {
        if (pendingSmall !== null) {
          currentNumber = (currentNumber || 0) + pendingSmall
          pendingSmall = null
        }
        currentNumber += val
        lastWasMultiplier = false
      } else {
        flushNumber()
        currentNumber = val
        lastWasMultiplier = false
      }
    } else if (opMatch) {
      flushNumber()
      const op = opWords[opMatch]
      // If last result is also an operator, replace it (last operator wins).
      // Handles "and slows" → `+` then `-` → keeps `-` (the contextual operator).
      if (result.length > 0 && /^[+\-*/^]+$/.test(result[result.length - 1])) {
        result[result.length - 1] = op
      } else {
        result.push(op)
      }
    } else if (/^[+\-*/]$/.test(token)) {
      // Raw single-char operator (+, -, *, /). Accept only after a flushed number.
      // Excludes ^ — obfuscation noise like "FiVe^" produces false ^ tokens, and
      // real exponentiation is handled by the numeric pass in parseChallenge.
      flushNumber()
      if (result.length > 0 && /\d/.test(result[result.length - 1])) {
        result.push(token)
      }
    } else if (/^\d+$/.test(token)) {
      flushNumber()
      result.push(token)
    }
    // Unknown word — skip
  }
  flushNumber()

  return result.join(' ')
}

// ─── Expression cleanup ─────────────────────────────────────────────────────

/**
 * Remove orphan operators and adjacent-number duplicates.
 * Moltbook obfuscation inserts noise symbols and can produce duplicate number words.
 * Examples:
 *   "32 + / 14 -" → "32 + 14" (orphan operators removed)
 *   "30 33 * 4" → "33 * 4" (orphan number 30 before 33 dropped)
 */
function cleanMathExpr(expr: string): string {
  const parts = expr.split(/\s+/)
  const cleaned: string[] = []

  for (const part of parts) {
    const hasDigit = /\d/.test(part)
    const isOp = /^[+\-*/^]+$/.test(part)

    if (hasDigit) {
      // If last item is also a number (no operator between them), drop the previous
      // number — it's likely an obfuscation duplicate (e.g. "30 33" from split "thirty thirty three")
      if (cleaned.length > 0 && /\d/.test(cleaned[cleaned.length - 1])) {
        cleaned[cleaned.length - 1] = part
      } else {
        cleaned.push(part)
      }
    } else if (isOp && cleaned.length > 0 && /\d/.test(cleaned[cleaned.length - 1])) {
      // Only keep operators that follow a number
      cleaned.push(part)
    }
    // Skip operators not preceded by a number token
  }

  // Remove trailing operators
  while (cleaned.length > 0 && /^[+\-*/^]+$/.test(cleaned[cleaned.length - 1])) {
    cleaned.pop()
  }

  return cleaned.join(' ')
}

// ─── Challenge solver ────────────────────────────────────────────────────────

/**
 * Extract the verification block from an API response.
 * Moltbook nests it in different places depending on the endpoint:
 *   - Top-level: { verification_code, challenge_text }
 *   - Nested in post: { post: { verification: { verification_code, challenge_text } } }
 *   - Nested in comment: { comment: { verification: { verification_code, challenge_text } } }
 */
function findVerification(data: Record<string, unknown>): { code: string; challenge: string } | null {
  // Top-level verification_code (legacy format)
  if (data.verification_code) {
    return {
      code: String(data.verification_code),
      challenge: String(data.challenge || data.challenge_text || data.math_challenge || data.question || ''),
    }
  }

  // Nested in post or comment resource
  for (const key of ['post', 'comment'] as const) {
    const resource = data[key] as Record<string, unknown> | undefined
    if (!resource) continue

    // { post: { verification: { verification_code, challenge_text } } }
    const verification = resource.verification as Record<string, unknown> | undefined
    if (verification?.verification_code) {
      return {
        code: String(verification.verification_code),
        challenge: String(verification.challenge_text || verification.challenge || verification.math_challenge || ''),
      }
    }

    // { post: { verification_code, challenge_text } } — flat in resource
    if (resource.verification_code) {
      return {
        code: String(resource.verification_code),
        challenge: String(resource.challenge_text || resource.challenge || resource.math_challenge || ''),
      }
    }
  }

  return null
}

/**
 * Try to evaluate a math expression string safely.
 * Returns the numeric result or null if the expression is invalid.
 *
 * SECURITY NOTE: Function() constructor is used intentionally here.
 * The regex guard /^[\d+\-*\/().^ ]+$/ restricts input to digits, arithmetic
 * operators, parentheses, and spaces ONLY — no letters, no semicolons, no
 * assignment operators. This makes code injection impossible. A recursive-descent
 * parser would be marginally safer but unnecessary given the strict allowlist.
 */
function safeEval(expr: string): number | null {
  if (!expr || !/^[\d+\-*/().^ ]+$/.test(expr)) return null
  try {
    const jsExpr = expr.replace(/\^/g, '**')
    // eslint-disable-next-line no-new-func -- see SECURITY NOTE above
    const result = Function(`"use strict"; return (${jsExpr})`)() as number
    if (typeof result !== 'number' || !isFinite(result)) return null
    return result
  } catch {
    return null
  }
}

/**
 * Parse a verification challenge from an API response.
 * Returns the code and computed answer, or null if no challenge present.
 */
export function parseChallenge(data: Record<string, unknown>): ChallengeResult | null {
  if (!data) return null

  const v = findVerification(data)
  if (!v || !v.challenge) return null

  const code = v.code
  const challenge = v.challenge

  // Pass 0: Try direct numeric evaluation for challenges like "5 + 3" or "(10 + 5) * 3".
  // Extract anything that looks like a math expression from the raw challenge text.
  const numericMatch = challenge.replace(/[^0-9+\-*/().^ ]/g, ' ').match(/[\d+\-*/().^ ]+/)
  if (numericMatch) {
    const rawExpr = numericMatch[0].trim().replace(/^[+\-*/^ ]+/, '').replace(/[+\-*/^ ]+$/, '').trim()
    const answer = safeEval(rawExpr)
    if (answer !== null) {
      log.info('parseChallenge solved (numeric)', { mathExpr: rawExpr, answer: answer.toFixed(2) })
      return { code, answer: answer.toFixed(2), rawChallenge: challenge, mathExpr: rawExpr }
    }
  }

  // Pass 1: Word-based challenges — convert word numbers/operators to math.
  // Per-token fuzzy dedup handles obfuscation ("thrree" → "three", "twweenttyy" → "twenty")
  // without breaking words with natural doubles.
  const preprocessed = wordsToMath(challenge)
  const mathMatch = preprocessed.match(/[\d+\-*/().^ ]+/)
  if (mathMatch) {
    // Strip leading/trailing operators — obfuscation can leave stray ^, /, + at edges
    const rawExpr = mathMatch[0].trim().replace(/^[+\-*/^ ]+/, '').replace(/[+\-*/^ ]+$/, '').trim()

    // Try direct evaluation first (handles clean expressions)
    let answer = safeEval(rawExpr)
    let finalExpr = rawExpr

    // If direct eval fails, try cleaning orphan operators from the middle
    if (answer === null) {
      const cleaned = cleanMathExpr(rawExpr)
      answer = safeEval(cleaned)
      if (answer !== null) finalExpr = cleaned
    }

    if (answer !== null) {
      log.info('parseChallenge solved (words)', { mathExpr: finalExpr, answer: answer.toFixed(2) })
      return { code, answer: answer.toFixed(2), rawChallenge: challenge, mathExpr: finalExpr }
    }
  }

  return null
}

/**
 * Submit a verification challenge answer to the Moltbook API.
 */
async function submitVerification(
  apiKey: string,
  challenge: ChallengeResult,
): Promise<Record<string, unknown>> {
  return moltbookPost(`${MOLTBOOK_API_BASE}/verify`, apiKey, {
    verification_code: challenge.code,
    answer: challenge.answer,
  })
}

// ─── ID extraction ──────────────────────────────────────────────────────────

/**
 * Extract a resource ID from an API response. Moltbook API nests IDs in
 * various shapes: `{ post: { id } }`, `{ post_id }`, `{ id }`, etc.
 */
function extractId(data: Record<string, unknown>, kind: 'post' | 'comment'): string | undefined {
  // { post: { id: "..." } } or { comment: { id: "..." } }
  if (data[kind] && typeof data[kind] === 'object' && (data[kind] as Record<string, unknown>).id) {
    return String((data[kind] as Record<string, unknown>).id)
  }
  // { post_id: "..." } or { comment_id: "..." }
  if (data[`${kind}_id`]) return String(data[`${kind}_id`])
  // { id: "..." } — direct
  if (data.id) return String(data.id)
  return undefined
}

// ─── Verified post/comment wrappers ─────────────────────────────────────────

/**
 * Create a post on Moltbook with automatic verification challenge solving.
 */
export async function createPostVerified(
  apiKey: string,
  data: { submolt: string; title: string; content?: string },
): Promise<Record<string, unknown>> {
  const body = await moltbookPost(`${MOLTBOOK_API_BASE}/posts`, apiKey, data)
  log.info('post API response', { hasVerification: !!findVerification(body), keys: Object.keys(body) })

  // Check for API-level errors (Moltbook returns { statusCode, message, error, ... })
  if (body.error || body.statusCode) {
    const reason = body.message ?? body.error ?? 'unknown'
    throw new Error(`Moltbook post rejected (${body.statusCode ?? '?'}): ${reason}`)
  }

  // Solve verification challenge if present
  const challenge = parseChallenge(body)
  if (challenge) {
    log.info('solving post challenge', { challenge: challenge.rawChallenge, mathExpr: challenge.mathExpr, answer: challenge.answer })
    const verifyResult = await submitVerification(apiKey, challenge)
    log.info('post verify result', { success: verifyResult.success, keys: Object.keys(verifyResult) })

    if (verifyResult.success === false || verifyResult.error) {
      throw new Error(`Post verification failed: ${JSON.stringify(verifyResult.error ?? verifyResult)}`)
    }

    const postId = extractId(verifyResult, 'post')
    return {
      ...verifyResult,
      _challenge: challenge.rawChallenge,
      _mathExpr: challenge.mathExpr,
      _answer: challenge.answer,
      _postId: postId,
    }
  }

  // Direct success — extract post ID from body
  const postId = extractId(body, 'post')
  return { ...body, _postId: postId }
}

/**
 * Create a comment on Moltbook with automatic verification challenge solving.
 */
export async function createCommentVerified(
  apiKey: string,
  postId: string,
  content: string,
): Promise<Record<string, unknown>> {
  log.info('submitting comment', { postId, contentLength: content.length, contentPreview: content.slice(0, 100) })
  const body = await moltbookPost(`${MOLTBOOK_API_BASE}/posts/${postId}/comments`, apiKey, { content })
  log.info('comment API response', { postId, hasVerification: !!findVerification(body), keys: Object.keys(body) })

  // Check for API-level errors (Moltbook returns { statusCode, message, error, ... })
  if (body.error || body.statusCode) {
    const reason = body.message ?? body.error ?? 'unknown'
    throw new Error(`Moltbook comment rejected (${body.statusCode ?? '?'}): ${reason}`)
  }

  const challenge = parseChallenge(body)
  if (challenge) {
    log.info('solving comment challenge', { postId, challenge: challenge.rawChallenge, mathExpr: challenge.mathExpr, answer: challenge.answer })
    const verifyResult = await submitVerification(apiKey, challenge)
    log.info('comment verify result', { postId, success: verifyResult.success, keys: Object.keys(verifyResult) })

    if (verifyResult.success === false || verifyResult.error) {
      throw new Error(`Comment verification failed: ${JSON.stringify(verifyResult.error ?? verifyResult)}`)
    }

    const commentId = extractId(verifyResult, 'comment')
    return {
      ...verifyResult,
      _challenge: challenge.rawChallenge,
      _mathExpr: challenge.mathExpr,
      _answer: challenge.answer,
      _postId: postId,
      _commentId: commentId,
    }
  }

  // No challenge — check if direct success or silent failure
  if (!body.comment && !body.id && !body.comment_id) {
    log.warn('comment response has no challenge and no comment ID — may have silently failed', { postId, body: JSON.stringify(body).slice(0, 300) })
  }

  const commentId = extractId(body, 'comment')
  return { ...body, _postId: postId, _commentId: commentId }
}
