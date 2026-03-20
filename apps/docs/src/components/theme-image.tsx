'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface ThemeImageProps {
  lightSrc: string
  darkSrc: string
  alt: string
  caption?: string
  width?: number
}

export function ThemeImage({ lightSrc, darkSrc, alt, caption, width }: ThemeImageProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isOpen])

  if (!mounted) {
    return <div style={{ width: width || '100%', height: 300, borderRadius: '0.75rem', background: '#f5f5f5' }} />
  }

  const isDark = resolvedTheme === 'dark'
  const src = isDark ? darkSrc : lightSrc
  const borderColor = isDark ? '#262626' : '#e5e5e5'

  return (
    <>
      <figure style={{ margin: '2rem 0' }}>
        <button
          onClick={() => setIsOpen(true)}
          style={{
            display: 'block',
            width: width || '100%',
            cursor: 'zoom-in',
            position: 'relative',
            background: 'none',
            border: 'none',
            padding: 0,
            margin: '0 auto',
          }}
        >
          <img
            src={src}
            alt={alt}
            width={width}
            style={{
              display: 'block',
              width: '100%',
              borderRadius: '0.75rem',
              border: `1px solid ${borderColor}`,
              transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
            }}
          />
        </button>
        {caption && (
          <figcaption style={{ textAlign: 'center', fontSize: '0.875rem', color: '#888', marginTop: '0.75rem' }}>
            {caption}
          </figcaption>
        )}
      </figure>

      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            cursor: 'zoom-out',
          }}
        >
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close"
            style={{
              position: 'absolute',
              top: '1rem',
              right: '1rem',
              padding: '0.5rem',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)' }}
          >
            <X style={{ width: 24, height: 24, color: 'white' }} />
          </button>
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '100%',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: '0.5rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              cursor: 'default',
            }}
          />
          {caption && (
            <p style={{
              position: 'absolute',
              bottom: '1rem',
              left: '50%',
              transform: 'translateX(-50%)',
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: '0.875rem',
              background: 'rgba(0, 0, 0, 0.5)',
              padding: '0.5rem 1rem',
              borderRadius: '9999px',
            }}>
              {caption}
            </p>
          )}
        </div>
      )}
    </>
  )
}
