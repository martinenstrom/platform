/**
 * Measure what the browser can offer a voice loop — feature detection only.
 *
 * Nothing here opens a microphone, records, or speaks. It loads HQ in the
 * same headless Chromium the other probes use and asks the page which APIs
 * exist, so the voice measurement rests on what the browser reports rather
 * than on what a table says. The result describes THIS browser build; user
 * browsers differ, and that difference is part of the finding.
 *
 *   node scripts/probe-voice-capabilities.mjs            (dev server on :5173)
 */

import { chromium } from 'playwright'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`${base}/`, { waitUntil: 'networkidle' })

const capabilities = await page.evaluate(async () => {
  const has = (name) => name in window
  const recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
  const voices = 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : []
  const recorderTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  return {
    userAgent: navigator.userAgent,
    speechRecognition: {
      present: Boolean(recognition),
      prefixed: !('SpeechRecognition' in window) && 'webkitSpeechRecognition' in window,
      continuousAndInterim: recognition
        ? 'continuous' in new recognition() && 'interimResults' in new recognition()
        : null,
    },
    speechSynthesis: {
      present: has('speechSynthesis'),
      voices: voices.length,
      swedishVoices: voices.filter((voice) => voice.lang.toLowerCase().startsWith('sv'))
        .length,
    },
    capture: {
      getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      mediaRecorder: has('MediaRecorder'),
      recorderTypes: has('MediaRecorder')
        ? Object.fromEntries(
            recorderTypes.map((type) => [type, MediaRecorder.isTypeSupported(type)]),
          )
        : null,
      audioWorklet: has('AudioContext') && 'audioWorklet' in AudioContext.prototype,
      permissionsApi: Boolean(navigator.permissions?.query),
      microphonePermission: navigator.permissions?.query
        ? await navigator.permissions
            .query({ name: 'microphone' })
            .then((status) => status.state)
            .catch((error) => `unsupported: ${error.message}`)
        : null,
    },
    transport: {
      webSocket: has('WebSocket'),
      webRtc: has('RTCPeerConnection'),
      fetchStreamingBody: typeof ReadableStream !== 'undefined' && has('fetch'),
      eventSource: has('EventSource'),
    },
    playback: {
      audioElement: typeof Audio !== 'undefined',
      audioContext: has('AudioContext'),
      mediaSource: has('MediaSource'),
      mediaSourceOpus: has('MediaSource')
        ? MediaSource.isTypeSupported('audio/webm;codecs=opus')
        : null,
      mediaSourceMp3: has('MediaSource')
        ? MediaSource.isTypeSupported('audio/mpeg')
        : null,
    },
  }
})

console.log(JSON.stringify(capabilities, null, 2))
await browser.close()
