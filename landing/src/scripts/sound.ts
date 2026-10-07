/**
 * Underwater ambience + UI click sounds. Opt-in: default is muted, nothing
 * plays until the user enables sound and interacts with the page.
 *
 * Parent wiring (rendered by SoundToggle.astro):
 *   button[data-sound-toggle]        aria-pressed toggle, textContent = label
 *   audio[data-sound-ambient]        ambient loop
 *   audio[data-sound-click]          UI click tick
 */
import { id as copyId } from '../content/translations';

const STORAGE_KEY = 'anchoa-sound';
const FADE_MS = 600;
const AMBIENT_VOLUME = 0.22;
const CLICK_VOLUME = 0.15;
const labelOn = copyId['snd.on'];
const labelOff = copyId['snd.off'];

function readStoredState(): 'on' | 'off' {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on' ? 'on' : 'off';
  } catch {
    /* Storage is optional. */
    return 'off';
  }
}

function persistState(state: 'on' | 'off'): void {
  try {
    localStorage.setItem(STORAGE_KEY, state);
  } catch {
    /* Storage is optional. */
  }
}

export function initSound(): void {
  const toggle =
    document.querySelector<HTMLButtonElement>('[data-sound-toggle]');
  const ambient = document.querySelector<HTMLAudioElement>(
    '[data-sound-ambient]',
  );
  const click = document.querySelector<HTMLAudioElement>('[data-sound-click]');
  if (!toggle || !ambient || !click) return;

  // Closures below run outside the guard, where narrowing is dropped: bind the
  // already-narrowed elements to non-null constants instead of using `!`.
  const toggleEl: HTMLButtonElement = toggle;
  const ambientEl: HTMLAudioElement = ambient;
  const clickEl: HTMLAudioElement = click;

  ambientEl.loop = true;
  ambientEl.volume = 0;
  clickEl.volume = CLICK_VOLUME;

  let state: 'on' | 'off' = readStoredState();
  const label = (): string => (state === 'on' ? labelOff : labelOn);

  // Linear volume ramp over rAF frames; self-cancelling per run.
  const fade = (() => {
    let handle = 0;
    function cancel(): void {
      cancelAnimationFrame(handle);
      handle = 0;
    }
    function run(from: number, to: number, onDone?: () => void): void {
      cancel();
      const start = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / FADE_MS);
        ambientEl.volume = from + (to - from) * t;
        if (t < 1) handle = requestAnimationFrame(step);
        else onDone?.();
      };
      handle = requestAnimationFrame(step);
    }
    return { cancel, run };
  })();

  function startAmbient(): void {
    fade.run(0, AMBIENT_VOLUME);
    ambientEl.loop = true;
    void ambientEl.play().catch(() => {});
  }

  function stopAmbient(): void {
    fade.run(ambientEl.volume, 0, () => {
      if (state === 'off') ambientEl.pause();
    });
  }

  function playClick(): void {
    clickEl.currentTime = 0;
    void clickEl.play().catch(() => {});
  }

  // Sync the chrome: aria-pressed plus the label text and accessible name.
  function syncButton(): void {
    const text = label();
    toggleEl.setAttribute('aria-pressed', String(state === 'on'));
    toggleEl.setAttribute('aria-label', text);
    const span = toggleEl.querySelector<HTMLElement>('[data-i18n]');
    if (span) span.textContent = text;
  }

  toggleEl.addEventListener('click', () => {
    const wasOn = state === 'on';
    state = wasOn ? 'off' : 'on';
    persistState(state);
    syncButton();
    if (wasOn) stopAmbient();
    else startAmbient();
    if (state === 'on') playClick();
  });

  // Preload only on the first real user interaction.
  function armAudio(): void {
    for (const element of [ambientEl, clickEl]) {
      element.preload = 'auto';
      element.load();
    }
    document.removeEventListener('pointerdown', armAudio);
    document.removeEventListener('keydown', armAudio);
  }
  document.addEventListener('pointerdown', armAudio, { once: true });
  document.addEventListener('keydown', armAudio, { once: true });

  // Delegated UI clicks: styled buttons and links get the tick.
  document.addEventListener('click', (event) => {
    if (state !== 'on') return;
    const target = event.target;
    if (target instanceof Element && target.closest('a.btn, button.btn, [data-sfx]'))
      playClick();
  });

  // interactions.ts rewrites [data-i18n] text, then fires this event: adopt it.
  document.addEventListener('anchoa:languagechange', () => {
    const span = toggleEl.querySelector<HTMLElement>('[data-i18n]');
    if (span?.textContent) toggleEl.setAttribute('aria-label', span.textContent);
  });

  syncButton();
  document.documentElement.dataset['sound'] = state;
}
