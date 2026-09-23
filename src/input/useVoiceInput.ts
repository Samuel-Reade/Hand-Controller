// Voice -> InputBus: saying "open" confirms the node under the eyes
// (clickless selection, Sam 2026-09-22). It emits the same unpositioned
// `tap` as Enter, so the scene's gaze routing applies: first "open"
// selects the ringed node, the second opens it. "leave" is Escape: it
// closes an open post, or lets go of the selected node. "centre" is the
// one-look re-centre of the gaze pointer (look at the middle).
//
// The Web Speech API (Chrome, Edge, Safari; not Firefox). It listens only
// while eye control is on and EYE.voiceConfirm is set, and only fires while
// the gaze ring is on a node - "open" in conversation with no ring does
// nothing. Chrome sends the audio to its speech service.

import { useEffect } from 'react'
import { useStore } from '../store'
import type { InputBus } from './InputBus'
import { FLAGS } from '../config/flags'
import { EYE } from './eye/config'
import { gazeRuntime } from '../neural/gazeFocus'

export type VoiceStatus = 'off' | 'listening' | 'unsupported' | 'denied'

/** Shared runtime for the HUD (pointRuntime pattern). */
export const voiceRuntime = { status: 'off' as VoiceStatus, heard: '' }

/** Module controller: the leva toggle calls sync() so the mic follows it. */
export const voiceControl = { sync: (): void => {} }

/** The command word, as a whole word anywhere in the phrase ("open", "open it", "okay open"). */
export function heardOpen(transcript: string): boolean {
  return /\bopen\b/i.test(transcript)
}

/** "centre" re-centres the gaze pointer (US English transcribes it "center"). */
export function heardCentre(transcript: string): boolean {
  return /\b(re-?)?cent(re|er)\b/i.test(transcript)
}

/** "leave" backs out, as Escape does. "leaf" is how the recogniser often hears it on its own. */
export function heardLeave(transcript: string): boolean {
  return /\b(leave|leaf)\b/i.test(transcript)
}

// Minimal typings: lib.dom does not ship SpeechRecognition.
interface SpeechResult { isFinal: boolean; 0: { transcript: string } }
interface SpeechEvent { resultIndex: number; results: ArrayLike<SpeechResult> }
interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useVoiceInput(bus: InputBus): void {
  useEffect(() => {
    const Ctor = recognitionCtor()
    let rec: Recognition | null = null
    let wanted = false
    /** result indices that already fired: interim results repeat as they grow, then arrive final */
    const fired = new Set<number>()

    const start = () => {
      if (rec || !Ctor) return
      const r = new Ctor()
      r.continuous = true
      r.interimResults = true // act on the interim word: waiting for a final costs ~1 s
      r.lang = navigator.language || 'en-US'
      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (fired.has(i)) continue
          const text = e.results[i][0].transcript
          voiceRuntime.heard = text.trim()
          // "leave" wins over "open" in one phrase: backing out is the safe one
          if (heardLeave(text)) {
            fired.add(i)
            // Escape's two steps: a post open closes it; otherwise the
            // selected node lets go and the brain takes the centre again.
            const store = useStore.getState()
            if (store.openReport) store.closeReport()
            else bus.emit({ type: 'home' })
            continue
          }
          if (heardCentre(text)) {
            fired.add(i)
            bus.emit({ type: 'recentre' })
            continue
          }
          if (!heardOpen(text)) continue
          fired.add(i)
          if (!gazeRuntime.live || !gazeRuntime.name || useStore.getState().openReport) continue
          bus.emit({ type: 'tap' })
        }
      }
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          voiceRuntime.status = 'denied'
          wanted = false
        }
      }
      // Chrome ends a continuous session after a silence or a network blip:
      // restart while still wanted. Result indices restart with it.
      r.onend = () => {
        if (rec !== r) return // a stopped session ending late
        rec = null
        fired.clear()
        if (wanted) setTimeout(() => { if (wanted) start() }, 250) // no hot loop on a repeating error
        else if (voiceRuntime.status === 'listening') voiceRuntime.status = 'off'
      }
      rec = r
      try {
        r.start()
        voiceRuntime.status = 'listening'
      } catch {
        rec = null
      }
    }

    const stop = () => {
      wanted = false
      rec?.stop()
      rec = null
      fired.clear()
      if (voiceRuntime.status === 'listening') voiceRuntime.status = 'off'
    }

    const sync = () => {
      if (!Ctor) {
        voiceRuntime.status = 'unsupported'
        return
      }
      const want = FLAGS.eye && useStore.getState().eyeEnabled && EYE.voiceConfirm
      if (want && voiceRuntime.status === 'denied') return // the browser said no; do not prompt again
      if (want) {
        wanted = true
        start()
      } else {
        stop()
      }
    }

    voiceControl.sync = sync
    sync()
    const offStore = useStore.subscribe((s, prev) => {
      if (s.eyeEnabled !== prev.eyeEnabled) sync()
    })
    return () => {
      offStore()
      stop()
      voiceControl.sync = () => {}
    }
  }, [bus])
}
