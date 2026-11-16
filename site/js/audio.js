// Audio for voice prompts: Infinity needs PCM WAV, 16-bit, mono, 48 kHz.
//
// Conversion uses the browser's Web Audio API (no ffmpeg needed): the source is
// decoded with decodeAudioData (MP3, WAV, OGG, M4A/AAC, FLAC... depending on the
// browser), then rendered through an OfflineAudioContext at 48 kHz mono, which
// resamples and down-mixes, and finally written out as a 16-bit WAV.

import * as rules from "./rules.js";
import { wavInfo } from "./formats.js";

export const AUDIO_SOURCE_EXTENSIONS = [".wav", ".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".webm", ".aif", ".aiff"];

export class AudioConversionError extends Error {}

/** True if the bytes are already a WAV Infinity accepts (so no conversion is needed). */
export function isInfinityWav(bytes) {
  try {
    const info = wavInfo(bytes);
    return info.format === 1
      && info.channels === rules.AUDIO_CHANNELS
      && info.bitsPerSample === rules.AUDIO_SAMPLE_WIDTH_BYTES * 8
      && info.sampleRate === rules.AUDIO_SAMPLE_RATE;
  } catch {
    return false;
  }
}

/** Duration in seconds of a PCM WAV, or null if it cannot be read. */
export function wavDuration(bytes) {
  try {
    const info = wavInfo(bytes);
    const frameBytes = info.channels * (info.bitsPerSample / 8);
    return frameBytes ? info.dataLength / frameBytes / info.sampleRate : null;
  } catch {
    return null;
  }
}

/** Encode mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav(samples, sampleRate = rules.AUDIO_SAMPLE_RATE) {
  const dataLength = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataLength);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + dataLength, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);          // fmt chunk size
  v.setUint16(20, 1, true);           // PCM
  v.setUint16(22, 1, true);           // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true);           // block align
  v.setUint16(34, 16, true);          // bits per sample
  str(36, "data");
  v.setUint32(40, dataLength, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/**
 * Convert any audio the browser can decode to Infinity's WAV format.
 * Returns { bytes, converted } — converted is false when the input was already compliant.
 */
export async function toInfinityWav(bytes) {
  if (isInfinityWav(bytes)) return { bytes, converted: false };
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new AudioConversionError("This browser cannot convert audio. Try a current version of Chrome, Edge, Firefox or Safari.");

  let decoded;
  try {
    // decodeAudioData detaches the buffer it is given, so pass a copy.
    const decoder = new Offline(1, 1, rules.AUDIO_SAMPLE_RATE);
    decoded = await decoder.decodeAudioData(bytes.slice().buffer);
  } catch {
    throw new AudioConversionError("This browser could not read that audio file. Try MP3 or WAV.");
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * rules.AUDIO_SAMPLE_RATE));
  const ctx = new Offline(rules.AUDIO_CHANNELS, frames, rules.AUDIO_SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination); // down-mixes to mono and resamples to 48 kHz
  src.start();
  const rendered = await ctx.startRendering();
  return { bytes: encodeWav(rendered.getChannelData(0)), converted: true };
}
