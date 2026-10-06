/**
 * voiceLevel — the loudness of whatever Ako is "saying", 0..1, for <AnchoaPet level={…}>.
 *
 *   const stop = voiceLevel(ttsAudioEl, (v) => (level = v));   // call after a user gesture
 *   …
 *   stop();                                                      // when the audio ends
 *
 * Works with an <audio>/<video> element or any AudioNode (pass its AudioContext).
 * Runs on requestAnimationFrame only while speaking, so it costs nothing when idle.
 */
export function voiceLevel(
  source: HTMLMediaElement | AudioNode,
  onLevel: (v: number) => void,
  ctx?: AudioContext,
): () => void {
  const ac = ctx ?? (source instanceof AudioNode ? (source.context as AudioContext) : new AudioContext());
  const node = source instanceof AudioNode ? source : ac.createMediaElementSource(source);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  node.connect(analyser);
  if (!(source instanceof AudioNode)) node.connect(ac.destination);
  const buf = new Float32Array(analyser.fftSize);
  let smooth = 0;
  let raf = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const v = Math.min(1, rms * 6);
    smooth += (v - smooth) * (v > smooth ? 0.6 : 0.25); // fast open, softer close
    onLevel(smooth);
    raf = requestAnimationFrame(tick);
  };
  void ac.resume();
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    analyser.disconnect();
    onLevel(0);
  };
}
