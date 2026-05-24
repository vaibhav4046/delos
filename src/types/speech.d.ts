// Minimal Web Speech API types — TS lib.dom may not include these in all versions.

interface SpeechRecognitionEventResultAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionEventResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionEventResultAlternative;
}

interface SpeechRecognitionEventResultList {
  length: number;
  [index: number]: SpeechRecognitionEventResult;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionEventResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare const SpeechRecognition: { new (): SpeechRecognition } | undefined;
declare const webkitSpeechRecognition: { new (): SpeechRecognition } | undefined;
