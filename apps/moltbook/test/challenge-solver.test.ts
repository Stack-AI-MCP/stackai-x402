import { describe, it, expect } from 'vitest'
import { wordsToMath, parseChallenge } from '../src/moltbook/challenge-solver.js'

describe('wordsToMath', () => {
  it('converts simple number words', () => {
    expect(wordsToMath('three plus four')).toBe('3 + 4')
  })

  it('converts compound numbers', () => {
    expect(wordsToMath('thirty two')).toBe('32')
  })

  it('handles mixed case', () => {
    expect(wordsToMath('ThIrTy TwO NeWtOnS aNd SeVeN')).toBe('32 + 7')
  })

  it('handles hundreds', () => {
    expect(wordsToMath('three hundred')).toBe('300')
  })

  it('handles compound hundreds', () => {
    expect(wordsToMath('two hundred forty five')).toBe('245')
  })

  it('handles thousands', () => {
    expect(wordsToMath('three thousand five hundred')).toBe('3500')
  })

  it('handles multiplication words', () => {
    expect(wordsToMath('five times six')).toBe('5 * 6')
  })

  it('handles division words', () => {
    expect(wordsToMath('ten divided by two')).toBe('10 / 2')
  })

  it('handles subtraction words', () => {
    expect(wordsToMath('twenty minus three')).toBe('20 - 3')
  })

  it('passes through numeric expressions', () => {
    expect(wordsToMath('123 + 456')).toBe('123 + 456')
  })

  it('handles mixed words and digits', () => {
    expect(wordsToMath('three plus 4')).toBe('3 + 4')
  })

  it('strips unknown words', () => {
    expect(wordsToMath('what is five plus ten apples')).toBe('5 + 10')
  })

  it('handles "and" as plus', () => {
    expect(wordsToMath('seven and three')).toBe('7 + 3')
  })
})

describe('parseChallenge', () => {
  it('returns null when no verification_code', () => {
    expect(parseChallenge({ success: true })).toBeNull()
  })

  it('returns null when no challenge text', () => {
    expect(parseChallenge({ verification_code: 'abc123' })).toBeNull()
  })

  it('solves simple addition', () => {
    const result = parseChallenge({
      verification_code: 'abc123',
      challenge: 'What is 5 + 3?',
    })
    expect(result).toMatchObject({ code: 'abc123', answer: '8.00' })
  })

  it('solves multiplication', () => {
    const result = parseChallenge({
      verification_code: 'abc123',
      challenge: 'What is 7 * 6?',
    })
    expect(result).toMatchObject({ code: 'abc123', answer: '42.00' })
  })

  it('solves division with decimals', () => {
    const result = parseChallenge({
      verification_code: 'abc123',
      challenge: 'What is 10 / 3?',
    })
    expect(result).toMatchObject({ code: 'abc123', answer: '3.33' })
  })

  it('solves word-based challenges', () => {
    const result = parseChallenge({
      verification_code: 'code1',
      challenge: 'thirty two plus seven',
    })
    expect(result).toMatchObject({ code: 'code1', answer: '39.00' })
  })

  it('handles math_challenge field', () => {
    const result = parseChallenge({
      verification_code: 'code2',
      math_challenge: '100 - 37',
    })
    expect(result).toMatchObject({ code: 'code2', answer: '63.00' })
  })

  it('handles question field', () => {
    const result = parseChallenge({
      verification_code: 'code3',
      question: '15 * 4',
    })
    expect(result).toMatchObject({ code: 'code3', answer: '60.00' })
  })

  it('handles complex expressions', () => {
    const result = parseChallenge({
      verification_code: 'code4',
      challenge: '(10 + 5) * 3',
    })
    expect(result).toMatchObject({ code: 'code4', answer: '45.00' })
  })

  it('handles exponentiation with ^', () => {
    const result = parseChallenge({
      verification_code: 'code5',
      challenge: '2 ^ 10',
    })
    expect(result).toMatchObject({ code: 'code5', answer: '1024.00' })
  })

  it('finds challenge nested in comment.verification (real Moltbook format)', () => {
    const result = parseChallenge({
      success: true,
      comment: {
        id: 'comment-1',
        verification_status: 'pending',
        verification: {
          verification_code: 'moltbook_verify_abc123',
          challenge_text: 'ThIrTy nEwToNs+ TwEl.Ve nEwToNs, HoW mUcH ToTaL?',
          expires_at: '2026-03-15 16:07:24.605276+00',
          instructions: 'Solve the math problem...',
        },
      },
    })
    expect(result).toMatchObject({ code: 'moltbook_verify_abc123', answer: '42.00' })
  })

  it('finds challenge nested in post.verification (real Moltbook format)', () => {
    const result = parseChallenge({
      success: true,
      post: {
        id: 'post-1',
        verification: {
          verification_code: 'moltbook_verify_xyz',
          challenge_text: 'What is twenty plus five?',
        },
      },
    })
    expect(result).toMatchObject({ code: 'moltbook_verify_xyz', answer: '25.00' })
  })

  it('solves obfuscated lobster challenge from real API', () => {
    const result = parseChallenge({
      success: true,
      comment: {
        verification: {
          verification_code: 'moltbook_verify_bbca7002',
          challenge_text: "A] LoB.sT eR] S^tRaPs[ iTs ClAw] aNd^ ApPlIeS[ ThIr.Ty] nEwToNs+ TwEl.Ve] nEwToNs, HoW^ mUcH{ ToTaL] fOrCe Is/ tHeN?",
        },
      },
    })
    expect(result).toMatchObject({ code: 'moltbook_verify_bbca7002', answer: '42.00' })
  })

  it('solves challenge with noise operators between numbers', () => {
    // Challenge like "thirty two newtons ... other / claw ... fourteen newtons"
    // The "/" is noise from obfuscation, not a real division
    const result = parseChallenge({
      verification_code: 'noise_ops',
      challenge: 'ExErTs ThIrTy TwO NoOtOnS WiTh ItS LaRgE ClAw, AnD tHe OtH/ eR ClAw ExErTs FoUrTeEn NoOtOnS',
    })
    expect(result).toMatchObject({ code: 'noise_ops', answer: '46.00' })
  })
})
