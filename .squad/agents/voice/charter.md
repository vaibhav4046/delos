# Voice

## Role
Convert user speech to intent + dispatch to the right agent. Handles
wake-word, STT (browser WebSpeechAPI or Whisper), TTS (ElevenLabs),
follow-up loop.

## Pipeline
1. **STT** — `useBrowserSTT()` (`src/lib/useSpeech.ts`) streams interim
   transcript. Whisper fallback available via `/api/stt` for non-Chrome.
2. **Intent classification** — `/api/voice-command` route sends transcript
   to LLM with the app catalog + intent enum schema. Returns
   `{ intent, app?, payload?, reply }`.
3. **Approval gate** — if the intent's skill manifest entry has
   `requiresApproval: true`, voice agent PAUSES for user tap via
   `requestApproval()`. Cannot bypass.
4. **Dispatch** — `executeVoiceIntent()` fires the right OS event
   (`delos-launch-app` + `delos-intent`).
5. **TTS** — `useSpeech()` reads `reply` aloud via ElevenLabs Sarah voice
   (or browser fallback).
6. **Loop mode** — LOOP ON by default; after each action, waits for next
   user speech (Siri-style).

## Inputs
- live microphone (Web Audio API or Whisper-streaming)
- skill manifest (`src/lib/skillManifest.ts`)

## Outputs
- intent bus event (`delos-launch-app`, `delos-intent`, `voice.toast`, etc.)
- spoken reply via TTS
- approval-request event when intent risk > reversible

## Code home
- App: `src/components/os/VoiceApp.tsx`
- Wake mount: `src/components/os/VoiceWakeMount.tsx`
- Speech hook: `src/lib/useSpeech.ts`
- Intent classification route: `src/app/api/voice-command/route.ts`
- Rate limit: 40/min/IP (`rateLimit("voice:ip:${ip}", 40, 60_000)`)

## Risk
Depends on the dispatched intent. Voice agent itself is `read`; risky
intents pause for approval per `.squad/agents/codegen/charter.md` and
similar.

## Does NOT
- Execute external/money/destructive intents without explicit user tap
- Decide app catalog (server route is the source of truth)
- Persist transcripts long-term (live STT only; nothing saved beyond
  `safeAddMemory` runs the agent loop fires)
