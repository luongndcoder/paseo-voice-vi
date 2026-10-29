/**
 * Shared streaming helpers for the sherpa-onnx online transducer engines.
 * (Moved out of the Nemotron engine so the Zipformer engine reuses them.)
 */

/**
 * The codeswitch/Nemotron BPE vocab is uppercase-only, so raw transcripts
 * come out SHOUTING. Lowercase everything, then capitalize sentence starts.
 * Proper nouns and acronyms lose their caps — an acceptable trade for
 * readable dictation output.
 */
export function normalizeCasing(text: string): string {
  const lowered = text.toLowerCase();
  return lowered.replace(/(^|[.!?…]\s+)([\p{L}])/gu, (_, prefix: string, letter: string) =>
    prefix + letter.toUpperCase(),
  );
}

/**
 * Collapses immediate word/phrase repetitions caused by streaming chunk boundaries.
 * Ported from Scribble's `src-tauri/src/stt/text.rs`.
 */
export function collapseRepeats(text: string): string {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length < 2) {
    return words.join(" ");
  }

  const stripPunct = (s: string): string =>
    s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();

  let current = words;
  for (let pass = 0; pass < 3; pass += 1) {
    const out: string[] = [];
    let i = 0;
    while (i < current.length) {
      let skipped = false;
      const maxN = Math.min(4, Math.floor((current.length - i) / 2));
      for (let n = maxN; n >= 1; n -= 1) {
        let matches = true;
        for (let k = 0; k < n; k += 1) {
          const a = stripPunct(current[i + k]);
          const b = stripPunct(current[i + n + k]);
          if (!a || a !== b) {
            matches = false;
            break;
          }
        }
        if (matches) {
          for (let k = 0; k < n; k += 1) {
            out.push(current[i + k]);
          }
          i += n * 2;
          while (i + n <= current.length) {
            let more = true;
            for (let k = 0; k < n; k += 1) {
              if (stripPunct(current[i + k]) !== stripPunct(out[out.length - n + k])) {
                more = false;
                break;
              }
            }
            if (more) {
              i += n;
            } else {
              break;
            }
          }
          skipped = true;
          break;
        }
      }
      if (!skipped) {
        out.push(current[i]);
        i += 1;
      }
    }
    if (out.length === current.length) {
      current = out;
      break;
    }
    current = out;
  }

  return current.join(" ");
}

export function normalizeChunkGain(samples: Float32Array): Float32Array {
  if (samples.length === 0) {
    return samples;
  }
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) {
      peak = abs;
    }
  }
  if (peak <= 0.008 || peak >= 0.25) {
    return samples;
  }
  const gain = Math.min(0.45 / peak, 6.0);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  }
  return out;
}

export function resampleLinear(
  input: Float32Array,
  fromSampleRate: number,
  toSampleRate: number,
): Float32Array {
  if (fromSampleRate === toSampleRate) {
    return input;
  }
  if (fromSampleRate <= 0 || toSampleRate <= 0) {
    throw new Error(`Invalid sample rate conversion: ${fromSampleRate} -> ${toSampleRate}`);
  }
  if (input.length === 0) {
    return new Float32Array(0);
  }
  const ratio = toSampleRate / fromSampleRate;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = srcPos - i0;
    const s0 = input[Math.min(input.length - 1, Math.max(0, i0))];
    const s1 = input[i1];
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}
