import { useEffect, useRef, useState } from 'react'
import { splitIntoSentences } from '../lib/sentenceSplit'

type PlaybackState = 'idle' | 'playing' | 'paused'

interface Props {
  sceneId: string
  prose: string
}

// Phase 4 read-aloud (spec: "Text-to-speech playback with sentence-level
// highlighting"). Uses the browser-native window.speechSynthesis API
// available in Electron's Chromium runtime — no new dependency. Rather than
// relying on a single long utterance's `onboundary` event for
// sentence-granularity charIndex mapping (unreliable across Chromium
// versions — onboundary is typically word-granularity, not sentence), each
// sentence is spoken as its own SpeechSynthesisUtterance in sequence, with
// the currently-speaking index driving highlighting in a simple overlay
// panel rather than deep ProseMirror/Tiptap decoration integration.
export function ReadAloudControl({ sceneId, prose }: Props): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle')
  const [currentIndex, setCurrentIndex] = useState(-1)

  const sentences = useRef<string[]>([])
  sentences.current = splitIntoSentences(prose)

  // Guards against a queued utterance's onend firing after cancel() or
  // unmount and advancing to the next sentence anyway — cancel() doesn't
  // synchronously prevent an in-flight callback in every Chromium build.
  const stoppedRef = useRef(true)

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  function stop(): void {
    stoppedRef.current = true
    if (supported) window.speechSynthesis.cancel()
    setPlaybackState('idle')
    setCurrentIndex(-1)
  }

  // Switching scenes mid-playback would keep reading the previous scene's
  // sentences over the newly-loaded one — stop instead.
  useEffect(() => {
    stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId])

  useEffect(() => stop, [])

  function speakFrom(index: number): void {
    if (!supported) return
    if (index >= sentences.current.length) {
      stoppedRef.current = true
      setPlaybackState('idle')
      setCurrentIndex(-1)
      return
    }
    stoppedRef.current = false
    const utterance = new SpeechSynthesisUtterance(sentences.current[index])
    utterance.onend = () => {
      if (stoppedRef.current) return
      speakFrom(index + 1)
    }
    utterance.onerror = () => {
      stoppedRef.current = true
      setPlaybackState('idle')
    }
    setCurrentIndex(index)
    setPlaybackState('playing')
    window.speechSynthesis.speak(utterance)
  }

  function play(): void {
    if (!supported || sentences.current.length === 0) return
    if (playbackState === 'paused') {
      window.speechSynthesis.resume()
      setPlaybackState('playing')
      return
    }
    speakFrom(currentIndex >= 0 ? currentIndex : 0)
  }

  function pause(): void {
    if (!supported || playbackState !== 'playing') return
    window.speechSynthesis.pause()
    setPlaybackState('paused')
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          ...pillButtonStyle,
          border: `1px solid ${playbackState !== 'idle' ? 'var(--c-amber)' : 'var(--c-border)'}`,
          color: playbackState !== 'idle' ? 'var(--c-amber)' : 'var(--c-ink-soft)'
        }}
      >
        Read Aloud
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 34,
            right: 0,
            width: 320,
            maxHeight: 360,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--c-surface-raised)',
            border: '1px solid var(--c-border)',
            borderRadius: 10,
            boxShadow: '0 12px 28px rgba(0,0,0,0.16)',
            zIndex: 40,
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 12px',
              borderBottom: '1px solid var(--c-border)'
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)' }}>
              Read Aloud
            </span>
            <button onClick={() => setIsOpen(false)} style={closeButtonStyle} aria-label="Close read-aloud panel">
              ×
            </button>
          </div>

          {!supported && (
            <div style={{ padding: 14, fontSize: 12.5, color: 'var(--c-ink-faint)' }}>
              Text-to-speech isn't available in this build.
            </div>
          )}

          {supported && sentences.current.length === 0 && (
            <div style={{ padding: 14, fontSize: 12.5, color: 'var(--c-ink-faint)' }}>Nothing to read yet.</div>
          )}

          {supported && sentences.current.length > 0 && (
            <>
              <div style={{ overflowY: 'auto', padding: '10px 12px', fontSize: 13, lineHeight: 1.6 }}>
                {sentences.current.map((sentence, i) => (
                  <span
                    key={i}
                    style={{
                      background: i === currentIndex ? 'var(--c-accent-soft)' : 'transparent',
                      color: i === currentIndex ? 'var(--c-accent-text)' : 'var(--c-ink)',
                      borderRadius: 3,
                      padding: '1px 2px'
                    }}
                  >
                    {sentence}{' '}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--c-border)' }}>
                {playbackState === 'playing' ? (
                  <button onClick={pause} style={controlButtonStyle}>
                    Pause
                  </button>
                ) : (
                  <button onClick={play} style={controlButtonStyle}>
                    {playbackState === 'paused' ? 'Resume' : 'Play'}
                  </button>
                )}
                <button onClick={stop} disabled={playbackState === 'idle'} style={controlButtonStyle}>
                  Stop
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const pillButtonStyle = {
  padding: '7px 13px',
  borderRadius: 7,
  border: '1px solid var(--c-border)',
  background: 'transparent',
  color: 'var(--c-ink-soft)',
  fontSize: 12.5,
  cursor: 'pointer'
} as const

const controlButtonStyle = {
  flex: 1,
  padding: '7px 0',
  borderRadius: 7,
  border: '1px solid var(--c-border)',
  background: 'transparent',
  color: 'var(--c-ink)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer'
} as const

const closeButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: 'var(--c-ink-faint)',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0
} as const
