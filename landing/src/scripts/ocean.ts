import type {
  Fish,
  Bubble,
  Glyph,
  Food,
  Jelly,
  Lantern,
  Snow,
  Tuna,
  LargeAnimal,
  Position,
} from './ocean/types';
import { createRenderers } from './ocean/renderers';

export function initOcean(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#sea');
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  mountOcean(canvas, context);
}

function mountOcean(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): void {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = motion.matches;
  let depthRatio = 0;
  const toggle = document.querySelector<HTMLButtonElement>(
    '[data-ocean-toggle]',
  );
  function updatePauseControl(): void {
    document.documentElement.dataset['oceanPaused'] = String(paused);
    toggle?.setAttribute('aria-pressed', String(paused));
    toggle?.setAttribute(
      'aria-label',
      paused ? 'Aktifkan animasi laut' : 'Jeda animasi laut',
    );
  }

  const GLYPHS = [
    '{',
    '}',
    '</>',
    ';',
    '=>',
    '[]',
    '()',
    '#',
    '0',
    '1',
    '&&',
    'fn',
  ];
  const TAU = Math.PI * 2;
  let W = 0,
    H = 0,
    DPR = 1,
    small = false;
  const fish: Fish[] = [],
    bubbles: Bubble[] = [],
    glyphs: Glyph[] = [],
    food: Food[] = [],
    jellies: Jelly[] = [],
    lanterns: Lantern[] = [],
    snow: Snow[] = [],
    tuna: Tuna[] = [];
  let big: LargeAnimal | null = null;
  const mouse = { x: -9999, y: -9999 };
  let t = 0,
    running = false,
    raf = 0,
    nextBig = 240,
    nextHunt = 720,
    bigTurn = 0,
    cap = 300,
    slow = 0,
    last = 0;
  const { drawFish, drawJelly, drawTurtle, drawManta, drawTuna, drawLantern } =
    createRenderers(ctx, () => DPR);
  const CELL = 56,
    grid = new Map<number, Fish[]>();
  const centres: [Position, Position] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  let school = { x: 0, y: 0 };

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const clamp = (v: number, a: number, b: number) =>
    v < a ? a : v > b ? b : v;
  const fit = <T>(arr: T[], n: number, make: (any: boolean) => T) => {
    while (arr.length < n) arr.push(make(true));
    arr.length = n;
  };

  function resize() {
    DPR = Math.min(1.5, devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    small = W < 700;
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    // density follows screen area: ~60 on a phone, ~240 on a 1440×900 laptop, max 300
    fit(fish, Math.round(clamp((W * H) / 5500, 60, cap)), newFish);
    fit(bubbles, Math.round(Math.min(30, W / 50)), newBubble);
    fit(glyphs, Math.round(Math.min(40, W / 36)), newGlyph);
    fit(jellies, small ? 2 : Math.round(clamp(W / 380, 3, 5)), newJelly);
    fit(lanterns, Math.round(clamp(W / 60, 10, 26)), newLantern);
    fit(snow, Math.round(clamp(W / 18, 24, 90)), newSnow);
    fish.sort((a, b) => a.z - b.z);
  }
  function newFish(): Fish {
    const z = Math.random(),
      a = rnd(-0.4, 0.4);
    return {
      x: rnd(W * 0.15, W * 0.85),
      y: rnd(H * 0.15, H * 0.7),
      vx: Math.cos(a) * 1.2,
      vy: Math.sin(a) * 1.2,
      z: z,
      s: 0.62 + z * 0.85 + rnd(-0.08, 0.08),
      ph: rnd(0, TAU),
      sc: Math.random() < 0.68 ? 0 : 1,
      fear: 0,
    };
  }
  function newBubble(any: boolean): Bubble {
    return {
      x: rnd(0, W),
      y: any ? rnd(0, H) : H + 10,
      r: rnd(1.2, 3.6),
      v: rnd(0.25, 0.8),
      w: rnd(0, TAU),
    };
  }
  function newGlyph(any: boolean): Glyph {
    return {
      x: rnd(0, W),
      y: any ? rnd(0, H) : H + 20,
      g: GLYPHS[(Math.random() * GLYPHS.length) | 0]!,
      v: rnd(0.08, 0.25),
      a: rnd(0.15, 0.5),
      sz: rnd(10, 15),
    };
  }
  function newJelly(any: boolean): Jelly {
    return {
      x: rnd(W * 0.05, W * 0.95),
      y: any ? rnd(H * 0.12, H * 0.9) : H + 90,
      r: rnd(13, small ? 20 : 30),
      ph: rnd(0, TAU),
      sp: rnd(0.028, 0.045),
      dx: rnd(-0.12, 0.12),
      z: rnd(0.35, 1),
    };
  }
  function newLantern(): Lantern {
    return {
      x: rnd(0, W),
      y: rnd(H * 0.08, H * 0.95),
      a: rnd(0, TAU),
      v: rnd(0.35, 0.8),
      s: rnd(1.5, 2.3) * (small ? 0.8 : 1),
      bl: rnd(0, TAU),
    };
  }
  function newSnow(any: boolean): Snow {
    return {
      x: rnd(0, W),
      y: any ? rnd(0, H) : -6,
      r: rnd(0.5, 1.5),
      v: rnd(0.12, 0.35),
      w: rnd(0, TAU),
    };
  }

  // a turtle near the surface, a manta further down; nothing big near 200 m
  function spawnBig() {
    const d = depthRatio;
    const kind =
      d < 0.38
        ? bigTurn++ % 2
          ? 'manta'
          : 'turtle'
        : d < 0.85
          ? 'manta'
          : null;
    if (!kind) return;
    const dir = Math.random() < 0.5 ? 1 : -1,
      k = small ? 0.62 : 1;
    const y = rnd(H * 0.2, H * 0.68);
    big = {
      kind: kind,
      dir: dir,
      x: dir > 0 ? -170 * k : W + 170 * k,
      y: y,
      base: y,
      ph: 0,
      k: k,
    };
  }
  // kawakawa come from the far side and drive through the main school
  function spawnHunt() {
    const dir = school.x < W / 2 ? -1 : 1,
      n = small ? 2 : 3;
    for (let i = 0; i < n; i++) {
      tuna.push({
        x: dir > 0 ? -90 - i * 60 : W + 90 + i * 60,
        y: school.y + rnd(-60, 60),
        vx: dir * 4.3,
        vy: 0,
        sp: rnd(4, 4.6),
        s: (small ? 0.75 : 1) * rnd(0.9, 1.12),
        ph: rnd(0, TAU),
        off: (i - (n - 1) / 2) * 34,
        life: 0,
      });
    }
  }

  function step() {
    t++;
    centres[0].x = W * (0.5 + 0.32 * Math.sin(t * 0.0021));
    centres[0].y = H * (0.42 + 0.22 * Math.sin(t * 0.0033 + 1.3));
    centres[1].x = W * (0.5 + 0.38 * Math.sin(t * 0.0016 + 2.4));
    centres[1].y = H * (0.5 + 0.25 * Math.sin(t * 0.0027 + 4.1));

    grid.clear();
    let sx0 = 0,
      sy0 = 0,
      n0 = 0;
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i]!,
        key =
          (Math.floor(f.x / CELL) + 64) * 4096 + Math.floor(f.y / CELL) + 64;
      let b = grid.get(key);
      if (!b) {
        b = [];
        grid.set(key, b);
      }
      b.push(f);
      if (f.sc === 0) {
        sx0 += f.x;
        sy0 += f.y;
        n0++;
      }
    }
    school = n0 ? { x: sx0 / n0, y: sy0 / n0 } : centres[0];

    for (let i = 0; i < fish.length; i++) {
      const f = fish[i]!,
        gx = Math.floor(f.x / CELL) + 64,
        gy = Math.floor(f.y / CELL) + 64;
      let sx = 0,
        sy = 0,
        ax = 0,
        ay = 0,
        cxs = 0,
        cys = 0,
        n = 0;
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++) {
          const b = grid.get((gx + ox) * 4096 + gy + oy);
          if (!b) continue;
          for (let j = 0; j < b.length; j++) {
            const o = b[j]!;
            if (o === f || Math.abs(o.z - f.z) > 0.35) continue;
            const dx = o.x - f.x,
              dy = o.y - f.y,
              d2 = dx * dx + dy * dy;
            if (d2 >= 3136) continue;
            if (d2 < 196 * f.s) {
              sx -= dx / (d2 + 1);
              sy -= dy / (d2 + 1);
            }
            if (o.sc !== f.sc) continue;
            n++;
            ax += o.vx;
            ay += o.vy;
            cxs += o.x;
            cys += o.y;
            if (o.fear > f.fear) f.fear += (o.fear - f.fear) * 0.08; // panic spreads through the school
          }
        }
      const coh = 0.0009 + f.fear * 0.0045;
      if (n) {
        f.vx += (ax / n - f.vx) * 0.045 + (cxs / n - f.x) * coh + sx * 1.6;
        f.vy += (ay / n - f.vy) * 0.045 + (cys / n - f.y) * coh + sy * 1.6;
      }
      const c = centres[f.sc];
      f.vx += (c.x - f.x) * 0.00012;
      f.vy += (c.y - f.y) * 0.00012;
      for (let k = 0; k < food.length; k++) {
        const p = food[k]!,
          dx = p.x - f.x,
          dy = p.y - f.y,
          d2 = dx * dx + dy * dy;
        if (d2 < 90000) {
          const d = Math.sqrt(d2) + 1;
          f.vx += (dx / d) * 0.09;
          f.vy += (dy / d) * 0.09;
          if (d < 9) p.e -= 0.05;
        }
      }
      for (let k = 0; k < tuna.length; k++) {
        const p = tuna[k]!,
          dx = f.x - p.x,
          dy = f.y - p.y,
          d2 = dx * dx + dy * dy;
        if (d2 < 30000) {
          const d = Math.sqrt(d2) + 1,
            q = (173 - d) / 173;
          f.vx += (dx / d) * 1.2 * q;
          f.vy += (dy / d) * 1.2 * q;
          f.fear = 1;
        }
      }
      for (let k = 0; k < jellies.length; k++) {
        const j = jellies[k]!,
          dx = f.x - j.x,
          dy = f.y - (j.y + j.r * 0.5),
          R = j.r * 1.4 + 18,
          d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) + 1;
          f.vx += (dx / d) * 0.22;
          f.vy += (dy / d) * 0.22;
        }
      }
      if (big) {
        const dx = f.x - big.x,
          dy = f.y - big.y,
          R = 95 * big.k,
          d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) + 1;
          f.vx += (dx / d) * 0.3;
          f.vy += (dy / d) * 0.3;
        }
      }
      const mx = f.x - mouse.x,
        my = f.y - mouse.y,
        md2 = mx * mx + my * my;
      if (md2 < 16000) {
        const d = Math.sqrt(md2) + 1;
        f.vx += (mx / d) * 0.7;
        f.vy += (my / d) * 0.7;
      }
      if (f.x < 40) f.vx += 0.08;
      if (f.x > W - 40) f.vx -= 0.08;
      if (f.y < 60) f.vy += 0.08;
      if (f.y > H - 40) f.vy -= 0.08;
      const sp = Math.hypot(f.vx, f.vy),
        max = 1.5 + f.z * 0.9 + f.fear * 1.9,
        min = 0.6;
      if (sp > max) {
        f.vx *= max / sp;
        f.vy *= max / sp;
      } else if (sp < min) {
        f.vx *= min / sp;
        f.vy *= min / sp;
      }
      f.x += f.vx;
      f.y += f.vy;
      f.ph += 0.25 + sp * 0.08;
      f.fear *= 0.985;
    }

    for (let i = tuna.length - 1; i >= 0; i--) {
      const p = tuna[i]!,
        dir = p.vx >= 0 ? 1 : -1;
      p.life++;
      p.ph += 0.42;
      if ((school.x - p.x) * dir > 50 && p.life < 420) {
        const base = dir > 0 ? 0 : Math.PI,
          cur = Math.atan2(p.vy, p.vx);
        let da = Math.atan2(school.y + p.off - p.y, school.x - p.x) - cur;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        let na = cur + clamp(da, -0.035, 0.035),
          rel = Math.atan2(Math.sin(na - base), Math.cos(na - base));
        na = base + clamp(rel, -0.6, 0.6);
        p.vx = Math.cos(na) * p.sp;
        p.vy = Math.sin(na) * p.sp;
      }
      p.x += p.vx;
      p.y += p.vy;
      if (
        p.x < -280 ||
        p.x > W + 280 ||
        p.y < -220 ||
        p.y > H + 220 ||
        p.life > 1200
      )
        tuna.splice(i, 1);
    }
    if (t >= nextHunt && !tuna.length) {
      if (depthRatio < 0.9) spawnHunt();
      nextHunt = t + rnd(1100, 1900);
    }

    if (big) {
      big.ph += big.kind === 'turtle' ? 0.045 : 0.03;
      big.x += big.dir * (big.kind === 'turtle' ? 0.9 : 1.25) * big.k;
      big.y = big.base + Math.sin(big.ph * 0.5) * 10;
      if (big.x < -260 || big.x > W + 260) {
        big = null;
        nextBig = t + rnd(900, 1500);
      }
    } else if (t >= nextBig) {
      spawnBig();
      if (!big) nextBig = t + 300;
    }

    for (const j of jellies) {
      j.ph += j.sp;
      j.y += 0.07 - 0.3 * Math.max(0, Math.sin(j.ph));
      j.x += j.dx + Math.sin(j.ph * 0.3) * 0.05;
      if (j.y < -j.r * 4) Object.assign(j, newJelly(false));
      if (j.x < -60) j.x = W + 60;
      else if (j.x > W + 60) j.x = -60;
    }
    if (depthRatio > 0.45) {
      for (const l of lanterns) {
        l.a += rnd(-0.05, 0.05);
        l.bl += 0.035;
        l.x += Math.cos(l.a) * l.v;
        l.y += Math.sin(l.a) * l.v * 0.5;
        if (l.x < -20) l.x = W + 20;
        else if (l.x > W + 20) l.x = -20;
        if (l.y < 30) l.a = Math.abs(l.a);
        else if (l.y > H - 20) l.a = -Math.abs(l.a);
      }
    }
    for (let k = food.length - 1; k >= 0; k--) {
      const p = food[k]!;
      p.y += 0.25;
      p.e -= 0.002;
      if (p.e <= 0) food.splice(k, 1);
    }
    for (const b of bubbles) {
      b.y -= b.v;
      b.w += 0.03;
      if (b.y < -10) Object.assign(b, newBubble(false));
    }
    for (const g of glyphs) {
      g.y -= g.v;
      if (g.y < -20) Object.assign(g, newGlyph(false));
    }
    for (const p of snow) {
      p.y += p.v;
      p.w += 0.02;
      if (p.y > H + 6) Object.assign(p, newSnow(false));
    }
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const d = depthRatio;
    const fishA = 1 - d * 0.7,
      glyphA = 0.25 + d * 0.9,
      lanternA = clamp((d - 0.5) / 0.32, 0, 1),
      snowA = 0.12 + d * 0.5;
    for (const g of glyphs) {
      ctx.globalAlpha = g.a * glyphA * 0.5;
      ctx.fillStyle = '#C6F36B';
      ctx.font = '500 ' + g.sz.toFixed(0) + "px 'JetBrains Mono', monospace";
      ctx.fillText(g.g, g.x, g.y);
    }
    ctx.fillStyle = '#DCE7EA';
    for (const p of snow) {
      ctx.globalAlpha = snowA * (0.4 + p.r * 0.35);
      ctx.fillRect(p.x + Math.sin(p.w) * 3, p.y, p.r, p.r);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#CFE3EA';
    for (const b of bubbles) {
      ctx.globalAlpha = 0.35 * (1 - d * 0.6);
      ctx.beginPath();
      ctx.arc(b.x + Math.sin(b.w) * 4, b.y, b.r, 0, TAU);
      ctx.stroke();
    }
    if (big) {
      const fade =
        big.kind === 'turtle'
          ? clamp((0.62 - d) / 0.24, 0, 1)
          : clamp((1 - d) / 0.2, 0, 1);
      if (fade > 0.01) {
        if (big.kind === 'manta') drawManta(big, 0.82 * fade);
        else drawTurtle(big, 0.9 * fade);
      }
    }
    for (const j of jellies) drawJelly(j, 1 - d * 0.35);
    if (lanternA > 0.01) for (const l of lanterns) drawLantern(l, lanternA);
    for (const p of food) {
      ctx.globalAlpha = Math.max(0, p.e);
      ctx.fillStyle = '#C6F36B';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = '#C6F36B';
    ctx.lineWidth = 0.7;
    for (const f of fish) drawFish(f, fishA);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const p of tuna) drawTuna(p, 0.92 * (1 - d * 0.35));
    ctx.globalAlpha = 1;
  }

  const frameInterval = 1000 / 30;
  function loop(now: number): void {
    if (!running) return;
    if (now - last >= frameInterval) {
      last = now;
      const started = performance.now();
      step();
      draw();
      if (t % 90 === 0) {
        slow = performance.now() - started > 20 ? slow + 1 : 0;
        if (slow > 2 && fish.length > 60) {
          cap = Math.max(60, Math.round(fish.length * 0.82));
          fish.length = cap;
          slow = 0;
        }
      }
    }
    raf = requestAnimationFrame(loop);
  }
  function syncAnimation(): void {
    const shouldRun = !paused && !document.hidden;
    cv.dataset['animation'] = shouldRun ? 'running' : 'paused';
    if (shouldRun && !running) {
      running = true;
      last = 0;
      raf = requestAnimationFrame(loop);
    } else if (!shouldRun && running) {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  let scrollPending = false;
  function updateDepth(): void {
    depthRatio = Math.min(
      1,
      Math.max(
        0,
        scrollY /
          Math.max(1, document.documentElement.scrollHeight - innerHeight),
      ),
    );
    if (paused) draw();
    scrollPending = false;
  }
  window.addEventListener(
    'scroll',
    () => {
      if (scrollPending) return;
      scrollPending = true;
      requestAnimationFrame(updateDepth);
    },
    { passive: true },
  );
  window.addEventListener(
    'resize',
    () => {
      resize();
      updateDepth();
      draw();
    },
    { passive: true },
  );
  window.addEventListener(
    'pointermove',
    (event) => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    },
    { passive: true },
  );
  window.addEventListener('pointerleave', () => {
    mouse.x = mouse.y = -9999;
  });
  window.addEventListener('pointerdown', (event) => {
    if (
      paused ||
      (event.target as Element).closest(
        'a, button, summary, input, label, code, pre',
      )
    )
      return;
    if (food.length > 48) food.splice(0, food.length - 48);
    for (let i = 0; i < 6; i++)
      food.push({
        x: event.clientX + rnd(-14, 14),
        y: event.clientY + rnd(-10, 10),
        e: 1,
      });
  });
  document.addEventListener('visibilitychange', syncAnimation);
  motion.addEventListener('change', (event) => {
    paused = event.matches;
    updatePauseControl();
    draw();
    syncAnimation();
  });
  toggle?.addEventListener('click', () => {
    paused = !paused;
    updatePauseControl();
    syncAnimation();
  });
  resize();
  updateDepth();
  for (let i = 0; i < (paused ? 160 : 40); i++) step();
  if (paused)
    big = {
      kind: 'turtle',
      dir: 1,
      x: W * 0.74,
      y: H * 0.3,
      base: H * 0.3,
      ph: 0.8,
      k: small ? 0.62 : 1,
    };
  updatePauseControl();
  draw();
  syncAnimation();
}
