"use client";

export type ArcadeSfxKind = "shutter" | "lockTick" | "capture" | "pop" | "countdown" | "fanfare";

class ArcadeSfx {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(
    ctx: AudioContext,
    freq: number,
    startOffset: number,
    duration: number,
    type: OscillatorType,
    gainPeak: number,
    freqEnd?: number,
  ) {
    const now = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  play(kind: ArcadeSfxKind) {
    const ctx = this.ensure();
    if (!ctx) return;
    if (kind === "shutter") {
      this.tone(ctx, 1320, 0, 0.07, "triangle", 0.14, 620);
      this.tone(ctx, 880, 0.05, 0.14, "sine", 0.12, 1320);
      return;
    }
    if (kind === "lockTick") {
      this.tone(ctx, 740, 0, 0.06, "sine", 0.07, 920);
      return;
    }
    if (kind === "capture") {
      this.tone(ctx, 523.25, 0, 0.11, "triangle", 0.14);
      this.tone(ctx, 659.25, 0.08, 0.11, "triangle", 0.14);
      this.tone(ctx, 783.99, 0.16, 0.14, "triangle", 0.16);
      this.tone(ctx, 1046.5, 0.24, 0.24, "sine", 0.18);
      return;
    }
    if (kind === "pop") {
      this.tone(ctx, 220, 0, 0.22, "sawtooth", 0.22, 48);
      this.tone(ctx, 640, 0, 0.12, "square", 0.12, 110);
      return;
    }
    if (kind === "countdown") {
      this.tone(ctx, 620, 0, 0.08, "sine", 0.08);
      return;
    }
    // fanfare
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((n, idx) => {
      this.tone(ctx, n, idx * 0.09, 0.26, "triangle", 0.14);
    });
  }
}

export const snapSfx = new ArcadeSfx();
