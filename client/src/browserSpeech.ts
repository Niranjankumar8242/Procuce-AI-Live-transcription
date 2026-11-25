interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}

interface RecognitionErrorEvent {
  error: string;
}

interface RecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionConstructor = new () => RecognitionInstance;

function recognitionConstructor(): RecognitionConstructor | undefined {
  const browserWindow = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
}

/**
 * Provides instant interim words in Chromium-based browsers. The self-hosted
 * Whisper stream still runs in parallel and remains the authoritative result.
 */
export class BrowserSpeechPreview {
  private recognition?: RecognitionInstance;
  private finalText = "";
  private currentText = "";
  private active = false;
  private stopResolver?: (text: string) => void;

  static isSupported(): boolean {
    return Boolean(recognitionConstructor());
  }

  constructor(private readonly onText: (text: string) => void) {}

  start(): boolean {
    const Recognition = recognitionConstructor();
    if (!Recognition) return false;
    const recognition = new Recognition();
    this.recognition = recognition;
    this.active = true;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript?.trim() ?? "";
        if (!transcript) continue;
        if (result.isFinal) this.finalText = `${this.finalText} ${transcript}`.trim();
        else interim = `${interim} ${transcript}`.trim();
      }
      this.currentText = `${this.finalText} ${interim}`.trim();
      this.onText(this.currentText);
    };
    recognition.onerror = (event) => {
      // no-speech is normal during pauses; Whisper continues independently.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") this.active = false;
    };
    recognition.onend = () => {
      if (this.stopResolver) {
        this.stopResolver(this.currentText);
        this.stopResolver = undefined;
        return;
      }
      // Chrome periodically ends long recognition sessions. Resume while the
      // recording is active so interim text continues without user action.
      if (this.active) {
        window.setTimeout(() => {
          try { recognition.start(); } catch { this.active = false; }
        }, 100);
      }
    };
    try {
      recognition.start();
      return true;
    } catch {
      this.active = false;
      return false;
    }
  }

  stop(): Promise<string> {
    this.active = false;
    if (!this.recognition) return Promise.resolve(this.currentText);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (text: string) => {
        if (settled) return;
        settled = true;
        resolve(text);
      };
      this.stopResolver = finish;
      window.setTimeout(() => finish(this.currentText), 500);
      try { this.recognition?.stop(); } catch { finish(this.currentText); }
    });
  }
}
