import type { Fish, Jelly, LargeAnimal, Tuna, Lantern } from './types';
const TAU = Math.PI * 2;
export function createRenderers(
  ctx: CanvasRenderingContext2D,
  getPixelRatio: () => number,
) {
  function drawFish(f: Fish, alpha: number) {
    const ang = Math.atan2(f.vy, f.vx),
      s = f.s * 1.25 * getPixelRatio(),
      wag = Math.sin(f.ph) * 0.35;
    const co = Math.cos(ang) * s,
      si = Math.sin(ang) * s;
    ctx.setTransform(
      co,
      si,
      -si,
      co,
      f.x * getPixelRatio(),
      f.y * getPixelRatio(),
    );
    const silver = 150 + Math.round(f.z * 80);
    ctx.globalAlpha = alpha * (0.3 + f.z * 0.45);
    ctx.fillStyle =
      'rgb(' + (silver - 20) + ',' + (silver + 10) + ',' + (silver + 25) + ')';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.bezierCurveTo(4, -2.6, -3, -2.8, -7, -0.6);
    ctx.lineTo(-7, 0.6);
    ctx.bezierCurveTo(-3, 2.8, 4, 2.6, 8, 0);
    ctx.moveTo(-6.5, 0);
    ctx.lineTo(-11, -2.8 + wag * 2);
    ctx.lineTo(-9.6, wag);
    ctx.lineTo(-11, 2.8 + wag * 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = alpha * (0.25 + f.z * 0.55);
    ctx.beginPath();
    ctx.moveTo(5.5, 0.1);
    ctx.lineTo(-6, 0.1);
    ctx.stroke();
  }

  function drawJelly(j: Jelly, a: number) {
    const k = Math.max(0, Math.sin(j.ph)),
      w = j.r * (1 - 0.18 * k),
      h = j.r * (0.62 + 0.16 * k),
      al = a * (0.45 + j.z * 0.4);
    ctx.save();
    ctx.translate(j.x, j.y);
    // marginal tentacles
    ctx.globalAlpha = al * 0.45;
    ctx.strokeStyle = '#CFE3EA';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const x0 = -w + (i / 16) * 2 * w,
        len = j.r * (0.75 + 0.3 * Math.sin(i * 1.7)) * (1 - 0.2 * k);
      ctx.moveTo(x0, 0);
      ctx.quadraticCurveTo(
        x0 + Math.sin(j.ph * 1.2 + i) * 4,
        len * 0.5,
        x0 + Math.sin(j.ph + i * 0.8) * 6,
        len,
      );
    }
    ctx.stroke();
    // four frilly oral arms
    ctx.globalAlpha = al * 0.55;
    ctx.strokeStyle = '#D9C9F5';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const x0 = (i - 1.5) * w * 0.17,
        L = j.r * 1.55;
      ctx.moveTo(x0, 0);
      ctx.bezierCurveTo(
        x0 + Math.sin(j.ph * 0.8 + i) * 6,
        L * 0.35,
        x0 - Math.sin(j.ph * 0.7 + i * 2) * 7,
        L * 0.7,
        x0 + Math.sin(j.ph * 0.9 + i) * 5,
        L,
      );
    }
    ctx.stroke();
    // bell
    const g = ctx.createRadialGradient(0, -h * 0.55, 1, 0, -h * 0.3, w * 1.15);
    g.addColorStop(0, 'rgba(236,242,255,0.55)');
    g.addColorStop(0.65, 'rgba(190,205,240,0.22)');
    g.addColorStop(1, 'rgba(198,243,107,0.08)');
    ctx.globalAlpha = al;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.bezierCurveTo(-w, -h * 1.3, w, -h * 1.3, w, 0);
    ctx.quadraticCurveTo(0, h * 0.22, -w, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(207,227,234,0.55)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // the four horseshoe gonads that give the moon jelly its name
    ctx.strokeStyle = 'rgba(227,184,240,0.75)';
    ctx.fillStyle = 'rgba(227,184,240,0.18)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 4; i++) {
      const u = (i - 1.5) / 1.5,
        rx = w * (0.15 - Math.abs(u) * 0.04);
      ctx.globalAlpha = al * (0.95 - Math.abs(u) * 0.35);
      ctx.beginPath();
      ctx.ellipse(
        u * w * 0.5,
        -h * (0.42 + (1 - Math.abs(u)) * 0.12),
        rx,
        rx * 0.62,
        u * 0.5,
        0,
        TAU,
      );
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTurtle(b: LargeAnimal, a: number) {
    const S = b.k;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(b.dir * S, S);
    ctx.globalAlpha = a;
    const fl = Math.sin(b.ph);
    const flipper = (
      x: number,
      y: number,
      rot: number,
      len: number,
      col: string,
    ) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.quadraticCurveTo(-len * 0.45, -5, -len, 7);
      ctx.quadraticCurveTo(-len * 0.45, 8, 0, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    flipper(14, 2, 0.35 + Math.sin(b.ph - 0.6) * 0.6, 40, '#2F4A40'); // far front flipper
    ctx.fillStyle = '#3A5A4E'; // rear flippers
    ctx.save();
    ctx.translate(-27, 6);
    ctx.rotate(0.55 + fl * 0.22);
    ctx.beginPath();
    ctx.ellipse(-7, 0, 11, 4, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#5C7D70'; // head & neck
    ctx.beginPath();
    ctx.ellipse(34, 0, 11, 7.5, -0.08, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0A1418';
    ctx.beginPath();
    ctx.arc(40, -2.5, 1.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#97A784'; // plastron
    ctx.beginPath();
    ctx.ellipse(0, 4, 31, 6.5, 0, 0, Math.PI);
    ctx.fill();
    const g = ctx.createLinearGradient(0, -22, 0, 4); // carapace
    g.addColorStop(0, '#56785F');
    g.addColorStop(1, '#33503F');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-33, 4);
    ctx.bezierCurveTo(-31, -21, 23, -25, 31, 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(198,243,107,0.26)';
    ctx.lineWidth = 1; // scutes
    ctx.beginPath();
    ctx.moveTo(-24, -6);
    ctx.quadraticCurveTo(-2, -20, 22, -6);
    for (const x of [-14, -2, 10]) {
      ctx.moveTo(x, -14 + Math.abs(x) * 0.12);
      ctx.lineTo(x + 3, 2);
    }
    ctx.stroke();
    flipper(17, 1, 0.25 + fl * 0.65, 48, '#5C7D70'); // near front flipper
    ctx.restore();
  }

  function drawManta(b: LargeAnimal, a: number) {
    const S = b.k,
      f = Math.sin(b.ph);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(b.dir * S, S * 0.6);
    ctx.globalAlpha = a;
    const ty = 80 + f * 10,
      tx = -12 - f * 8;
    ctx.strokeStyle = '#0A2230';
    ctx.lineWidth = 2; // tail
    ctx.beginPath();
    ctx.moveTo(-32, 0);
    ctx.quadraticCurveTo(
      -60,
      Math.sin(b.ph * 1.3) * 5,
      -96,
      Math.sin(b.ph * 1.3 + 1) * 4,
    );
    ctx.stroke();
    ctx.fillStyle = '#08202B';
    ctx.beginPath();
    ctx.moveTo(26, -12);
    ctx.bezierCurveTo(18, -42, 2, -ty * 0.82, tx, -ty);
    ctx.bezierCurveTo(-16, -ty * 0.58, -28, -24, -34, -6);
    ctx.lineTo(-34, 6);
    ctx.bezierCurveTo(-28, 24, -16, ty * 0.58, tx, ty);
    ctx.bezierCurveTo(2, ty * 0.82, 18, 42, 26, 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(207,227,234,0.14)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    for (const s of [-1, 1]) {
      // cephalic lobes
      ctx.beginPath();
      ctx.ellipse(31, s * 12, 8, 3.6, s * 0.35, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(207,227,234,0.13)'; // pale shoulder patches
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(6, s * 24, 13, 7, s * -0.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTuna(p: Tuna, a: number) {
    const ang = Math.atan2(p.vy, p.vx),
      wag = Math.sin(p.ph) * 0.2;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    if (Math.cos(ang) < 0) ctx.scale(1, -1);
    ctx.scale(p.s, p.s);
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(-21, 0);
    ctx.rotate(wag);
    ctx.fillStyle = '#1E3B4C'; // lunate tail
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-5, -6, -11, -12);
    ctx.quadraticCurveTo(-6, -4, -5, 0);
    ctx.quadraticCurveTo(-6, 4, -11, 12);
    ctx.quadraticCurveTo(-5, 6, 0, 0);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#A9BFCB'; // silver body
    ctx.beginPath();
    ctx.moveTo(27, 0);
    ctx.bezierCurveTo(19, -9.5, -10, -10, -21, -1.5);
    ctx.lineTo(-23, 0);
    ctx.lineTo(-21, 1.5);
    ctx.bezierCurveTo(-10, 9, 19, 8.5, 27, 0);
    ctx.fill();
    ctx.fillStyle = '#1E3B4C'; // dark back
    ctx.beginPath();
    ctx.moveTo(26.5, -0.8);
    ctx.bezierCurveTo(19, -9.5, -10, -10, -21, -1.5);
    ctx.bezierCurveTo(-8, -3.4, 12, -3, 26.5, -0.8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(169,191,203,0.5)';
    ctx.lineWidth = 0.8; // wavy back stripes
    ctx.beginPath();
    for (let x = -12; x <= 6; x += 6) {
      ctx.moveTo(x, -7);
      ctx.quadraticCurveTo(x - 2, -5, x - 5, -3.5);
    }
    ctx.stroke();
    ctx.fillStyle = '#1E3B4C';
    ctx.beginPath();
    ctx.moveTo(5, -8.5);
    ctx.lineTo(-1, -15);
    ctx.lineTo(-6, -8.5);
    ctx.fill(); // first dorsal
    for (let x = -10; x >= -18; x -= 3) {
      ctx.beginPath();
      ctx.moveTo(x, -4.6 - (x + 10) * -0.25);
      ctx.lineTo(x - 1.4, -6.6 - (x + 10) * -0.25);
      ctx.lineTo(x - 2, -4 - (x + 10) * -0.25);
      ctx.fill();
    }
    ctx.fillStyle = '#2B4A5C';
    ctx.beginPath();
    ctx.moveTo(13, 1);
    ctx.lineTo(1, 5);
    ctx.lineTo(10, 3);
    ctx.fill(); // pectoral
    ctx.fillStyle = '#16303E';
    for (const x of [7, 10.5, 14]) {
      ctx.beginPath();
      ctx.arc(x, 4.2, 0.9, 0, TAU);
      ctx.fill();
    } // spots
    ctx.fillStyle = '#0A1418';
    ctx.beginPath();
    ctx.arc(20.5, -1.4, 1.7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#CFE3EA';
    ctx.beginPath();
    ctx.arc(21, -1.9, 0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawLantern(l: Lantern, a: number) {
    const s = l.s,
      ang = l.a;
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(ang);
    if (Math.cos(ang) < 0) ctx.scale(1, -1);
    ctx.scale(s, s);
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = '#1F323C';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.bezierCurveTo(5, -3.4, -4, -3, -6.5, -0.6);
    ctx.lineTo(-10, -2.8);
    ctx.lineTo(-9, 0);
    ctx.lineTo(-10, 2.8);
    ctx.lineTo(-6.5, 0.6);
    ctx.bezierCurveTo(-4, 3, 5, 3.2, 7, 0);
    ctx.fill();
    ctx.fillStyle = '#0A1418';
    ctx.beginPath();
    ctx.arc(4.6, -0.7, 1.5, 0, TAU);
    ctx.fill();
    const glow = 0.55 + 0.45 * Math.sin(l.bl);
    for (let i = 0; i < 6; i++) {
      const x = 4 - i * 2,
        y = 2.1 - Math.abs(i - 2.5) * 0.15;
      ctx.globalAlpha = a * 0.22 * glow;
      ctx.fillStyle = '#8FF0E8';
      ctx.beginPath();
      ctx.arc(x, y, 2.3, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = a * (0.6 + 0.4 * glow);
      ctx.fillStyle = i % 2 ? '#C6F36B' : '#BFFAF4';
      ctx.beginPath();
      ctx.arc(x, y, 0.65, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  return { drawFish, drawJelly, drawTurtle, drawManta, drawTuna, drawLantern };
}
