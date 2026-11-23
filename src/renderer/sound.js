'use strict';

// Pure Web Audio API tactile thermal-printer foley (zero external audio files needed)
class TicketSound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  setEnabled(flag) {
    this.enabled = Boolean(flag);
  }

  ensureCtx() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // Crisp thermal ticket feed click ("ka-da")
  playPrint() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    [0, 0.045].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(i === 0 ? 520 : 760, now + offset);
      osc.frequency.exponentialRampToValueAtTime(190, now + offset + 0.032);
      gain.gain.setValueAtTime(0.08, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.036);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.04);
    });
  }

  // Satisfying rubber-stamp thump + bright chime
  playStamp(allDone = false) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(allDone ? 660 : 520, now);
    osc.frequency.exponentialRampToValueAtTime(allDone ? 990 : 740, now + 0.09);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);

    if (allDone) {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1046.5, now + 0.07);
      gain2.gain.setValueAtTime(0.07, now + 0.07);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.07);
      osc2.stop(now + 0.28);
    }
  }

  // Crisp paper rip sound when tearing off completed tickets
  playTear() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.14);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(3400, now + 0.12);
    filter.Q.value = 1.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  // Warm soft thermal hiss + gentle fade shimmer when heat-erasing completed receipt
  playThermalFade() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.72;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.sin((i / bufferSize) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env * 0.45;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(620, now);
    filter.frequency.exponentialRampToValueAtTime(1650, now + dur);
    filter.Q.value = 1.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  // Soft mechanical detent click for starting/pausing focus timer
  playFocusTick(starting = true) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(starting ? 580 : 420, now);
    osc.frequency.exponentialRampToValueAtTime(starting ? 760 : 320, now + 0.055);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);
  }

  // Warm gentle chime when 25-minute focus finishes
  playFocusDone() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t0 = now + i * 0.11;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.08, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.36);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.38);
    });
  }

  // Authentic rapid thermal stepper-motor feed ("zzz-zzz-zzz-ka") synced to 0.92s alert extrusion!
  playReceiptFeed() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const pulses = [0.02, 0.16, 0.34, 0.54, 0.72];

    pulses.forEach((offset, idx) => {
      const dur = 0.095;
      const bufSize = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        const env = Math.sin((i / bufSize) * Math.PI);
        data[i] = (Math.random() * 2 - 1) * env * 0.35;
      }

      const src = ctx.createBufferSource();
      src.buffer = buf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1150 + idx * 120, now + offset);
      bp.Q.value = 2.6;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.065, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);

      src.connect(bp);
      bp.connect(gain);
      gain.connect(ctx.destination);
      src.start(now + offset);
    });

    // Final gentle chime once ticket finishes extruding
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, now + 0.84);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.94);
    g.gain.setValueAtTime(0.07, now + 0.84);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.06);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now + 0.84);
    osc.stop(now + 1.08);
  }
}

window.ticketSound = new TicketSound();
