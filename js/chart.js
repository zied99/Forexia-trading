/* Forexia — graphiques SVG légers (lignes, marqueurs de trades, info-bulle). */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceTicks(min, max, count) {
    if (!(max > min)) { const d = Math.abs(min) * 0.01 || 1; min -= d; max += d; }
    const raw = (max - min) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
    return { ticks: ticks, step: step };
  }

  function linePath(values, x, y) {
    let d = '', pen = false;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
      pen = true;
    }
    return d;
  }

  /**
   * opts = { labels: [..], panels: [{ height, series: [{name, values, color, width, dash, fill}],
   *          markers: [{i, value, shape:'up'|'down'|'dot', color, title}], refLines: [{value, color}],
   *          format: fn, title }], formatLabel: fn }
   */
  function render(container, opts) {
    container.innerHTML = '';
    container.classList.add('chart');
    const W = Math.max(280, container.clientWidth);
    const n = opts.labels.length;
    const m = { l: 10, r: 62, t: 10, b: 26 };
    const gap = 14;
    const total = opts.panels.reduce((s, p) => s + p.height, 0) + gap * (opts.panels.length - 1) + m.t + m.b;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + total, width: W, height: total, role: 'img' }, container);
    if (opts.ariaLabel) svg.setAttribute('aria-label', opts.ariaLabel);
    const innerW = W - m.l - m.r;
    const x = (i) => m.l + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);

    let top = m.t;
    const panelInfo = [];
    for (const p of opts.panels) {
      const all = [];
      for (const s of p.series) for (const v of s.values) if (Number.isFinite(v)) all.push(v);
      for (const r of p.refLines || []) all.push(r.value);
      let lo = Math.min(...all), hi = Math.max(...all);
      if (p.min !== undefined) lo = Math.min(lo, p.min);
      if (p.max !== undefined) hi = Math.max(hi, p.max);
      const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.01 || 1;
      lo -= pad; hi += pad;
      const t0 = top, h = p.height;
      const y = (v) => t0 + h - ((v - lo) / (hi - lo)) * h;
      const g = el('g', {}, svg);
      const fmt = p.format || ((v) => v.toFixed(2));
      // grille + axe Y
      for (const t of niceTicks(lo, hi, Math.max(2, Math.round(h / 55))).ticks) {
        if (t < lo || t > hi) continue;
        el('line', { x1: m.l, x2: m.l + innerW, y1: y(t), y2: y(t), class: 'grid' }, g);
        const tx = el('text', { x: m.l + innerW + 6, y: y(t) + 4, class: 'axis' }, g);
        tx.textContent = fmt(t);
      }
      el('rect', { x: m.l, y: t0, width: innerW, height: h, class: 'frame' }, g);
      for (const r of p.refLines || []) {
        el('line', { x1: m.l, x2: m.l + innerW, y1: y(r.value), y2: y(r.value), class: 'ref', style: 'stroke:' + (r.color || 'var(--muted)') }, g);
      }
      if (p.title) { const tt = el('text', { x: m.l + 6, y: t0 + 14, class: 'ptitle' }, g); tt.textContent = p.title; }
      for (const s of p.series) {
        const d = linePath(s.values, x, y);
        if (!d) continue;
        if (s.fill) {
          const first = s.values.findIndex(Number.isFinite);
          let last = s.values.length - 1; while (last > 0 && !Number.isFinite(s.values[last])) last--;
          el('path', { d: d + 'L' + x(last) + ' ' + (t0 + h) + 'L' + x(first) + ' ' + (t0 + h) + 'Z', class: 'area', style: 'fill:' + s.color }, g);
        }
        el('path', {
          d: d, fill: 'none', style: 'stroke:' + s.color, 'stroke-width': s.width || 1.6,
          'stroke-dasharray': s.dash || '', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke',
        }, g);
      }
      for (const mk of p.markers || []) {
        const cx = x(mk.i), cy = y(mk.value);
        let shape;
        if (mk.shape === 'up') shape = el('path', { d: 'M' + cx + ' ' + (cy + 3) + 'l-5 9h10z' }, g);
        else if (mk.shape === 'down') shape = el('path', { d: 'M' + cx + ' ' + (cy - 3) + 'l-5 -9h10z' }, g);
        else shape = el('circle', { cx: cx, cy: cy, r: 3.5 }, g);
        shape.setAttribute('class', 'marker');
        shape.setAttribute('style', 'fill:' + mk.color);
        if (mk.title) { const ti = el('title', {}, shape); ti.textContent = mk.title; }
      }
      panelInfo.push({ p: p, y: y, top: t0, h: h, fmt: fmt });
      top += h + gap;
    }
    // axe X
    const bottom = top - gap;
    const fl = opts.formatLabel || ((s) => s);
    const nTicks = Math.max(2, Math.min(7, Math.floor(innerW / 95)));
    for (let k = 0; k < nTicks; k++) {
      const i = Math.round((k / (nTicks - 1)) * (n - 1));
      const tx = el('text', { x: x(i), y: bottom + 18, class: 'axis', 'text-anchor': k === 0 ? 'start' : k === nTicks - 1 ? 'end' : 'middle' }, svg);
      tx.textContent = fl(opts.labels[i]);
    }

    // interaction : réticule + info-bulle
    const cross = el('line', { y1: m.t, y2: bottom, class: 'cross', visibility: 'hidden' }, svg);
    const tip = document.createElement('div');
    tip.className = 'tip'; tip.hidden = true;
    container.appendChild(tip);
    const hit = el('rect', { x: m.l, y: m.t, width: innerW, height: bottom - m.t, fill: 'transparent' }, svg);
    function move(ev) {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / innerW) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      let html = '<b>' + opts.labels[i] + '</b>';
      for (const info of panelInfo) {
        for (const s of info.p.series) {
          if (!s.name || !Number.isFinite(s.values[i])) continue;
          html += '<div><i style="background:' + s.color + '"></i>' + s.name + ' <span>' + info.fmt(s.values[i], true) + '</span></div>';
        }
      }
      if (opts.extraTip) html += opts.extraTip(i);
      tip.innerHTML = html; tip.hidden = false;
      const cx = (x(i) / W) * rect.width;
      const tw = tip.offsetWidth;
      tip.style.left = (cx + 14 + tw > rect.width ? cx - 14 - tw : cx + 14) + 'px';
      tip.style.top = '8px';
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  /** Rendu adaptatif : redessine quand la largeur du conteneur change. */
  function mount(container, opts) {
    render(container, opts);
    if (container._ro) container._ro.disconnect();
    let lastW = container.clientWidth;
    container._ro = new ResizeObserver(() => {
      if (Math.abs(container.clientWidth - lastW) < 2) return;
      lastW = container.clientWidth;
      render(container, opts);
    });
    container._ro.observe(container);
  }

  root.Forexia.chart = { render, mount };
})(window);
