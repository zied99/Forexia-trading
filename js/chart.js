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
      for (const s of p.series) if (!s.noScale) for (const v of s.values) if (Number.isFinite(v)) all.push(v);
      for (const r of p.refLines || []) all.push(r.value);
      let lo = Math.min(...all), hi = Math.max(...all);
      if (p.min !== undefined) lo = Math.min(lo, p.min);
      if (p.max !== undefined) hi = Math.max(hi, p.max);
      const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.01 || 1;
      lo -= pad; hi += pad;
      const t0 = top, h = p.height;
      const y = (v) => t0 + h - ((v - lo) / (hi - lo)) * h;
      const g = el('g', {}, svg);
      // les repères dessinés peuvent sortir du cadre : on les coupe aux bords du panneau
      const clipId = 'clip' + Math.random().toString(36).slice(2, 9);
      const cp = el('clipPath', { id: clipId }, svg);
      el('rect', { x: m.l, y: t0, width: innerW, height: h }, cp);
      const fmt = p.format || ((v) => v.toFixed(2));
      // grille + axe Y
      for (const t of niceTicks(lo, hi, Math.max(2, Math.round(h / 55))).ticks) {
        if (t < lo || t > hi) continue;
        el('line', { x1: m.l, x2: m.l + innerW, y1: y(t), y2: y(t), class: 'grid' }, g);
        const tx = el('text', { x: m.l + innerW + 6, y: y(t) + 4, class: 'axis' }, g);
        tx.textContent = fmt(t);
      }
      el('rect', { x: m.l, y: t0, width: innerW, height: h, class: 'frame' }, g);
      // zone grisée (ex. période testée) : opts.shade = {from, to, label}
      if (opts.shade && opts.shade.to >= opts.shade.from && !panelInfo.length) {
        const x0 = x(Math.max(0, opts.shade.from)), x1 = x(Math.min(n - 1, opts.shade.to));
        el('rect', { x: x0, y: t0, width: Math.max(1, x1 - x0), height: h, class: 'shade' }, g);
        if (opts.shade.label && x1 - x0 > 90) { const st = el('text', { x: x0 + 6, y: t0 + h - 6, class: 'shade-label' }, g); st.textContent = opts.shade.label; }
      }
      for (const r of p.refLines || []) {
        el('line', { x1: m.l, x2: m.l + innerW, y1: y(r.value), y2: y(r.value), class: 'ref' + (r.strong ? ' strong' : ''), style: 'stroke:' + (r.color || 'var(--muted)') }, g);
        if (r.label) {
          // étiquette posée sur la ligne, à gauche, avec un fond pour rester lisible sur la courbe
          const above = y(r.value) - t0 > 18;
          const ty = above ? y(r.value) - 5 : y(r.value) + 14;
          const tx = el('text', { x: m.l + 8, y: ty, class: 'ref-label', style: 'fill:' + (r.color || 'var(--muted)') }, g);
          tx.textContent = r.label;
        }
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
        const path = el('path', {
          d: d, fill: 'none', style: 'stroke:' + s.color, 'stroke-width': s.width || 1.6,
          'stroke-dasharray': s.dash || '', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke',
        }, g);
        if (s.noScale) path.setAttribute('clip-path', 'url(#' + clipId + ')');
        if (s.label) {
          // numéro du repère au dernier point visible dans le cadre
          const last = s.values.reduce((k, v, i) => (Number.isFinite(v) && v >= lo && v <= hi ? i : k), -1);
          if (last >= 0) {
            const ly = y(s.values[last]) - 5 < t0 + 12 ? y(s.values[last]) + 14 : y(s.values[last]) - 5;
            const tl = el('text', { x: x(last) - 4, y: ly, class: 'ref-label', 'text-anchor': 'end', style: 'fill:' + s.color }, g);
            tl.textContent = s.label;
          }
        }
      }
      for (const mk of p.markers || []) {
        const cx = x(mk.i), cy = y(mk.value);
        let shape;
        if (mk.shape === 'star') {
          // étoile à 5 branches centrée sur le point
          let d = '';
          for (let k = 0; k < 10; k++) {
            const r = k % 2 ? 3.6 : 8.5, a = -Math.PI / 2 + (k * Math.PI) / 5;
            d += (k ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1);
          }
          shape = el('path', { d: d + 'Z' }, g);
          shape.setAttribute('class', 'marker star');
          shape.setAttribute('style', 'fill:' + mk.color);
          if (mk.title) { const ti = el('title', {}, shape); ti.textContent = mk.title; }
          continue;
        }
        if (mk.shape === 'up') shape = el('path', { d: 'M' + cx + ' ' + (cy + 3) + 'l-5 9h10z' }, g);
        else if (mk.shape === 'down') shape = el('path', { d: 'M' + cx + ' ' + (cy - 3) + 'l-5 -9h10z' }, g);
        else shape = el('circle', { cx: cx, cy: cy, r: 3.5 }, g);
        shape.setAttribute('class', 'marker');
        shape.setAttribute('style', 'fill:' + mk.color);
        if (mk.title) { const ti = el('title', {}, shape); ti.textContent = mk.title; }
      }
      panelInfo.push({ p: p, y: y, top: t0, h: h, fmt: fmt, inv: (py) => lo + ((t0 + h - py) / h) * (hi - lo) });
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
    // Mode dessin (opts.draw = {mode: 'h' | 'line', pending: {i, value}, onPoint(i, value)}) : clic dans le panneau des cours.
    const dr = opts.draw && opts.draw.mode ? opts.draw : null;
    const P0 = panelInfo[0];
    let guideH = null, guideL = null;
    if (dr) {
      svg.classList.add('drawing');
      guideH = el('line', { x1: m.l, x2: m.l + innerW, class: 'draw-guide', visibility: 'hidden' }, svg);
      guideL = el('line', { class: 'draw-guide', visibility: 'hidden' }, svg);
      if (dr.pending) el('circle', { cx: x(dr.pending.i), cy: P0.y(dr.pending.value), r: 5, class: 'draw-point' }, svg);
    }
    const pointAt = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W, py = ((ev.clientY - rect.top) / rect.height) * total;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / innerW) * (n - 1))));
      return { i: i, py: py, inside: py >= P0.top && py <= P0.top + P0.h };
    };
    function drawMove(ev) {
      const pt = pointAt(ev);
      if (!pt.inside) { guideH.setAttribute('visibility', 'hidden'); guideL.setAttribute('visibility', 'hidden'); return; }
      if (dr.mode === 'h') { guideH.setAttribute('y1', pt.py); guideH.setAttribute('y2', pt.py); guideH.setAttribute('visibility', 'visible'); }
      if (dr.mode === 'line' && dr.pending) {
        guideL.setAttribute('x1', x(dr.pending.i)); guideL.setAttribute('y1', P0.y(dr.pending.value));
        guideL.setAttribute('x2', x(pt.i)); guideL.setAttribute('y2', pt.py); guideL.setAttribute('visibility', 'visible');
      }
    }
    hit.addEventListener('pointermove', move);
    if (dr) {
      hit.addEventListener('pointermove', drawMove);
      hit.addEventListener('pointerdown', (ev) => {
        const pt = pointAt(ev);
        if (!pt.inside) return;
        ev.preventDefault();
        dr.onPoint(pt.i, P0.inv(pt.py));
      });
    } else hit.addEventListener('pointerdown', move);
    // Zoom (molette) et défilement (glisser) : opts.onZoom(facteur, position 0..1), opts.onPan(décalage en fraction de largeur)
    const frac = (ev) => { const r = svg.getBoundingClientRect(); return Math.max(0, Math.min(1, ((((ev.clientX - r.left) / r.width) * W) - m.l) / innerW)); };
    if (opts.onZoom) {
      hit.addEventListener('wheel', (ev) => { ev.preventDefault(); opts.onZoom(ev.deltaY > 0 ? 1.25 : 0.8, frac(ev)); }, { passive: false });
    }
    if (opts.onPan && !dr) {
      let start = null;
      hit.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'mouse' && ev.button === 0) { start = frac(ev); svg.classList.add('panning'); } });
      const end = (ev) => {
        if (start === null) return;
        const d = frac(ev) - start; start = null; svg.classList.remove('panning');
        if (Math.abs(d) > 0.01) opts.onPan(-d);
      };
      hit.addEventListener('pointerup', end);
      hit.addEventListener('pointerleave', end);
    }
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

  /**
   * Barres (une par mois) : opts = { labels, values, format(v), stars: [indices], titles: [texte au survol] }.
   * Vert si positif, rouge si négatif ; étoile jaune au-dessus des barres marquées.
   */
  function renderBars(container, opts) {
    container.innerHTML = '';
    container.classList.add('chart');
    const W = Math.max(280, container.clientWidth), H = opts.height || 190;
    const m = { l: 10, r: 62, t: opts.topLabels ? 34 : 18, b: 26 };
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img' }, container);
    if (opts.ariaLabel) svg.setAttribute('aria-label', opts.ariaLabel);
    const n = opts.values.length, innerW = W - m.l - m.r, innerH = H - m.t - m.b;
    const gv = (opts.ghosts || []).map((g) => g.value);
    let lo = Math.min(0, ...opts.values, ...gv), hi = Math.max(0, ...opts.values, ...gv);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; hi += pad; lo -= lo < 0 ? pad : 0;
    const y = (v) => m.t + innerH - ((v - lo) / (hi - lo)) * innerH;
    const fmt = opts.format || ((v) => String(v));
    for (const t of niceTicks(lo, hi, 4).ticks) {
      if (t < lo || t > hi) continue;
      el('line', { x1: m.l, x2: m.l + innerW, y1: y(t), y2: y(t), class: t === 0 ? 'zero' : 'grid' }, svg);
      const tx = el('text', { x: m.l + innerW + 6, y: y(t) + 4, class: 'axis' }, svg);
      tx.textContent = fmt(t);
    }
    const slot = innerW / Math.max(1, n), bw = Math.max(2, Math.min(38, slot * 0.68));
    // barres « fantômes » en pointillé (ex. résultat après prolongation), et barre en cours de calcul
    const ghostAt = new Map((opts.ghosts || []).map((g) => [g.i, g]));
    const hits = [];
    const stars = new Set(opts.stars || []);
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 64))));
    for (let i = 0; i < n; i++) {
      const v = opts.values[i], cx = m.l + slot * (i + 0.5);
      const top = y(Math.max(0, v)), bottom = y(Math.min(0, v));
      const r = el('rect', { x: cx - bw / 2, y: top, width: bw, height: Math.max(1, bottom - top), rx: 2, class: 'bar ' + (v >= 0 ? 'up' : 'down') }, svg);
      if (opts.titles) { const ti = el('title', {}, r); ti.textContent = opts.titles[i]; }
      const gh = ghostAt.get(i);
      if (gh) {
        const gt = y(Math.max(0, gh.value)), gb = y(Math.min(0, gh.value));
        const gr = el('rect', { x: cx - bw / 2 - 1, y: gt, width: bw + 2, height: Math.max(1, gb - gt), rx: 2, class: 'ghost ' + gh.kind }, svg);
        if (opts.titles) { const ti = el('title', {}, gr); ti.textContent = opts.titles[i]; }
      }
      // petit texte au-dessus de la barre (ex. durée de la période testée)
      if (opts.topLabels && opts.topLabels[i]) {
        const gTop = gh ? y(Math.max(0, gh.value)) : top;
        const ty = Math.min(top, gTop, y(0)) - 4;
        const L = opts.topLabels[i], narrow = slot < 40;
        // gain au-dessus de la barre (coloré), durée en petit au-dessus
        const tl = el('text', { x: cx, y: Math.max(22, ty), class: 'bar-top bar-gain ' + (L.cls || ''), 'text-anchor': 'middle' }, svg);
        tl.textContent = narrow ? L.short : L.long;
        if (L.sub && slot >= 26) { const ts = el('text', { x: cx, y: Math.max(22, ty) - 12, class: 'bar-top bar-sub', 'text-anchor': 'middle' }, svg); ts.textContent = narrow ? L.subShort : L.sub; }
        if (opts.titles) { const ti = el('title', {}, tl); ti.textContent = opts.titles[i]; }
      }
      if (opts.selected && opts.selected.includes(i)) el('rect', { x: cx - bw / 2 - 5, y: m.t - 2, width: bw + 10, height: innerH + 4, rx: 4, class: 'selected' }, svg);
      if (opts.onBarClick) {
        // zone cliquable sur toute la hauteur de la colonne ; glisser pour sélectionner plusieurs barres
        const hz = el('rect', { x: cx - slot / 2, y: 0, width: slot, height: H, class: 'bar-hit' }, svg);
        hz.dataset.i = i;
        if (opts.titles) { const ti = el('title', {}, hz); ti.textContent = opts.titles[i] + ' — clic : modifier · double-clic : recharger sur l\'écran principal · glisser ou Ctrl+clic : plusieurs'; }
        hits.push(hz);
      }
      if (opts.pending === i) el('rect', { x: cx - bw / 2 - 4, y: m.t, width: bw + 8, height: innerH, rx: 3, class: 'pending' }, svg);
      if (stars.has(i)) {
        const sy = top - 9;
        let d = '';
        for (let k = 0; k < 10; k++) {
          const rr = k % 2 ? 2.8 : 6.5, a = -Math.PI / 2 + (k * Math.PI) / 5;
          d += (k ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (sy + rr * Math.sin(a)).toFixed(1);
        }
        const st = el('path', { d: d + 'Z', class: 'marker star', style: 'fill:var(--star)' }, svg);
        if (opts.titles) { const ti = el('title', {}, st); ti.textContent = opts.titles[i]; }
      }
      if (i % every === 0) {
        const tx = el('text', { x: cx, y: H - 8, class: 'axis', 'text-anchor': 'middle' }, svg);
        tx.textContent = opts.labels[i];
      }
    }
  }
  // Sélection à la souris : clic, ou appui maintenu en glissant sur plusieurs barres
  function wireBarSelection(container, opts) {
    const svg = container.querySelector('svg');
    if (!svg || !opts.onBarClick) return;
    let start = null, cur = null;
    const hitAt = (ev) => { const t = document.elementFromPoint(ev.clientX, ev.clientY); return t && t.classList && t.classList.contains('bar-hit') ? +t.dataset.i : null; };
    const paint = () => svg.querySelectorAll('.bar-hit').forEach((h) => h.classList.toggle('dragsel', start !== null && cur !== null && +h.dataset.i >= Math.min(start, cur) && +h.dataset.i <= Math.max(start, cur)));
    svg.addEventListener('pointerdown', (ev) => { const i = hitAt(ev); if (i === null || ev.button !== 0) return; start = cur = i; paint(); ev.preventDefault(); });
    svg.addEventListener('pointermove', (ev) => { if (start === null) return; const i = hitAt(ev); if (i !== null && i !== cur) { cur = i; paint(); } });
    const end = (ev) => {
      if (start === null) return;
      const a = start, b = cur; start = cur = null; paint();
      if (a === b) opts.onBarClick(a, ev); else if (opts.onBarRange) opts.onBarRange(Math.min(a, b), Math.max(a, b), ev);
    };
    svg.addEventListener('pointerup', end);
    if (opts.onBarDblClick) svg.addEventListener('dblclick', (ev) => { const t = ev.target; if (t && t.classList && t.classList.contains('bar-hit')) opts.onBarDblClick(+t.dataset.i); });
    svg.addEventListener('pointerleave', (ev) => { if (start !== null) end(ev); });
  }
  function mountBars(container, opts) {
    renderBars(container, opts);
    wireBarSelection(container, opts);
    if (container._ro) container._ro.disconnect();
    let lastW = container.clientWidth;
    container._ro = new ResizeObserver(() => {
      if (Math.abs(container.clientWidth - lastW) < 2) return;
      lastW = container.clientWidth;
      renderBars(container, opts);
      wireBarSelection(container, opts);
    });
    container._ro.observe(container);
  }

  root.Forexia.chart = { render, mount, renderBars, mountBars };
})(window);
