import {
  en,
  id,
  type Language,
  type TranslationKey,
} from '../content/translations';

function currentLanguage(): Language {
  return document.documentElement.lang === 'en' ? 'en' : 'id';
}

function initLanguage(): void {
  function setLanguage(language: Language): void {
    const copy = language === 'en' ? en : id;
    document
      .querySelectorAll<HTMLElement>('[data-i18n], [data-i18n-html]')
      .forEach((element) => {
        const key = element.dataset['i18n'] ?? element.dataset['i18nHtml'];
        if (!key || !(key in copy)) return;
        const value = copy[key as TranslationKey];
        // HTML is limited to bundled, author-controlled headings and line breaks.
        if (element.hasAttribute('data-i18n-html') || value.includes('<br'))
          element.innerHTML = value;
        else element.textContent = value;
      });
    document.documentElement.lang = language;
    document
      .getElementById('lang-id')
      ?.setAttribute('aria-pressed', String(language === 'id'));
    document
      .getElementById('lang-en')
      ?.setAttribute('aria-pressed', String(language === 'en'));
    try {
      localStorage.setItem('anchoa-lang', language);
    } catch {
      /* Storage is optional. */
    }
    document.dispatchEvent(new Event('anchoa:languagechange'));
  }
  document
    .getElementById('lang-id')
    ?.addEventListener('click', () => setLanguage('id'));
  document
    .getElementById('lang-en')
    ?.addEventListener('click', () => setLanguage('en'));
  let language: Language = 'id';
  try {
    if (localStorage.getItem('anchoa-lang') === 'en') language = 'en';
  } catch {
    /* Storage is optional. */
  }
  if (location.hash === '#en') language = 'en';
  setLanguage(language);
}

function initClipboard(): void {
  const feedback = document.querySelector<HTMLElement>('[data-copy-feedback]');
  document
    .querySelectorAll<HTMLButtonElement>('[data-copy-target]')
    .forEach((button) => {
      button.addEventListener('click', async () => {
        const target = button.dataset['copyTarget'];
        const code = target ? document.getElementById(target) : null;
        if (!code) return;
        if (feedback) feedback.textContent = '';
        try {
          await navigator.clipboard.writeText(code.textContent ?? '');
          button.classList.add('done');
          button.textContent =
            currentLanguage() === 'en' ? 'Copied' : 'Tersalin';
          if (feedback)
            feedback.textContent =
              currentLanguage() === 'en'
                ? 'Installation command copied.'
                : 'Perintah instalasi berhasil disalin.';
          window.setTimeout(() => {
            button.classList.remove('done');
            button.textContent = currentLanguage() === 'en' ? 'Copy' : 'Salin';
          }, 1600);
        } catch {
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          if (feedback)
            feedback.textContent =
              currentLanguage() === 'en'
                ? 'Command selected. Copy the selected text manually.'
                : 'Perintah sudah dipilih. Tekan Ctrl+C atau salin teks secara manual.';
        }
      });
    });
}

function initReplicas(): void {
  const boxes = [...document.querySelectorAll<HTMLElement>('.dcm-fit')];
  // Scale the 1:1 design artboards to their box, like the reference.
  const fit = (): void =>
    boxes.forEach((box) =>
      box.style.setProperty(
        '--k',
        (box.clientWidth / Number(box.dataset['w'])).toFixed(4),
      ),
    );
  fit();
  const resize = new ResizeObserver(fit);
  // Pause looping avatar/wave animations while the replica is offscreen.
  const visible = new IntersectionObserver((entries) =>
    entries.forEach((entry) =>
      entry.target.classList.toggle('idle', !entry.isIntersecting),
    ),
  );
  boxes.forEach((box) => {
    resize.observe(box);
    visible.observe(box);
  });
}

function initDepthGauge(): void {
  const depth = document.getElementById('g-depth');
  const zone = document.getElementById('g-zone');
  const pin = document.getElementById('g-pin');
  let scheduled = false;
  const update = (): void => {
    const maximum = Math.max(
      1,
      document.documentElement.scrollHeight - innerHeight,
    );
    const ratio = Math.min(1, Math.max(0, scrollY / maximum));
    const metres = Math.round(ratio * 200);
    if (depth) depth.textContent = `−${metres} m`;
    if (zone)
      zone.textContent = (currentLanguage() === 'en' ? en : id)[
        metres < 200 ? 'zone.epi' : 'zone.meso'
      ];
    if (pin) pin.style.transform = `translateY(${ratio * 210}px)`;
    scheduled = false;
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  window.addEventListener('resize', update, { passive: true });
  document.addEventListener('anchoa:languagechange', update);
  update();
}

function initReveals(): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('below');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  document.querySelectorAll<HTMLElement>('.reveal').forEach((element) => {
    if (element.getBoundingClientRect().top <= innerHeight) return;
    element.classList.add('below');
    observer.observe(element);
  });
  document
    .querySelectorAll<HTMLElement>('.term .line')
    .forEach((line, index) => {
      if (index > 1) line.classList.add('dim');
      window.setTimeout(() => line.classList.remove('dim'), 350 + index * 260);
    });
}

export function initInteractions(): void {
  initReplicas();
  initDepthGauge();
  initLanguage();
  initClipboard();
  initReveals();
}
