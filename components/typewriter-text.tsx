'use client'

import { useEffect, useState } from 'react'

export function TypewriterText({ text, speed = 72 }: { text: string; speed?: number }) {
  const [visibleLength, setVisibleLength] = useState(0)

  useEffect(() => {
    setVisibleLength(0)
    let index = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const typeNext = () => {
      index += 1
      setVisibleLength(index)
      if (index >= text.length) return
      timer = setTimeout(typeNext, speed + (/[，。！？、]/.test(text.charAt(index - 1)) ? 170 : 0))
    }
    timer = setTimeout(typeNext, 260)
    return () => { if (timer) clearTimeout(timer) }
  }, [speed, text])

  return <span className="typewriter-text" aria-label={text}><span aria-hidden="true">{text.slice(0, visibleLength)}</span></span>
}
