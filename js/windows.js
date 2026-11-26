/* Fenêtres (popups) déplaçables et réductibles.
 * - glisser la barre de titre pour déplacer la fenêtre (double-clic : la remettre au centre) ;
 * - « — » la réduit en une petite barre en bas de l'écran : la page derrière redevient visible et utilisable
 *   (ex. regarder les simulations ou les résultats) ; « ▢ » ou un clic sur la barre la rouvre.
 * Le calcul en cours dans une fenêtre réduite continue. */
(function () {
  'use strict';
  const modals = () => [...document.querySelectorAll('.modal')];
  const minimized = () => modals().filter((m) => !m.hidden && m.classList.contains('win-min')).sort((a, b) => a.dataset.winAt - b.dataset.winAt);
  let minSeq = 0;
  const anyOpenFull = () => modals().some((m) => !m.hidden && !m.classList.contains('win-min') && !m.classList.contains('win-moved'));
  const titleOf = (m) => { const h = m.querySelector('.modal-head h2, .modal-head h3'); return h ? h.textContent.trim() : 'Fenêtre'; };

  function dock() {
    minimized().forEach((m, i) => { m.style.setProperty('--win-slot', i); });
    document.body.style.overflow = anyOpenFull() ? 'hidden' : '';
  }
  function setMin(m, on) {
    m.classList.toggle('win-min', on);
    if (on) m.dataset.winAt = ++minSeq;
    const b = m.querySelector('.win-min-btn');
    if (b) { b.textContent = on ? '▢' : '—'; b.title = on ? 'Rouvrir la fenêtre' : 'Réduire la fenêtre (pour voir la page derrière)'; b.setAttribute('aria-label', b.title); }
    const box = m.querySelector('.modal-box');
    if (box) box.style.transform = on ? '' : box.dataset.winT || '';
    dock();
  }
  function move(box, dx, dy) {
    const t = 'translate(' + Math.round(dx) + 'px, ' + Math.round(dy) + 'px)';
    box.dataset.winX = dx; box.dataset.winY = dy; box.dataset.winT = t; box.style.transform = t;
  }

  function enhance(m) {
    if (m.dataset.win) return;
    const head = m.querySelector('.modal-head'), box = m.querySelector('.modal-box');
    if (!head || !box) return;
    m.dataset.win = '1';
    head.classList.add('win-drag');
    head.title = 'Glisser pour déplacer · double-clic pour recentrer';
    const close = head.querySelector('button.close, [data-close]');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ghost close win-min-btn'; b.textContent = '—';
    b.title = 'Réduire la fenêtre (pour voir la page derrière)'; b.setAttribute('aria-label', b.title);
    const acts = document.createElement('div'); acts.className = 'win-acts';
    if (close && close.parentNode === head) { head.insertBefore(acts, close); acts.appendChild(b); acts.appendChild(close); } else { head.appendChild(acts); acts.appendChild(b); }
    b.addEventListener('click', (e) => { e.stopPropagation(); setMin(m, !m.classList.contains('win-min')); });

    let drag = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, input, select, textarea, a, label')) return;
      if (m.classList.contains('win-min')) return;
      if (window.matchMedia('(max-width: 600px)').matches) return; // sur téléphone : réduire seulement
      drag = { x: e.clientX, y: e.clientY, dx: Number(box.dataset.winX) || 0, dy: Number(box.dataset.winY) || 0, r: box.getBoundingClientRect() };
      head.setPointerCapture(e.pointerId); m.classList.add('win-moving'); e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      let dx = drag.dx + e.clientX - drag.x, dy = drag.dy + e.clientY - drag.y;
      // la barre de titre reste à l'écran
      const W = window.innerWidth, H = window.innerHeight, r = drag.r;
      // les boutons (à droite) restent visibles ; la fenêtre peut glisser en partie hors de l'écran à gauche
      dx = Math.min(Math.max(dx, drag.dx - r.left - Math.max(0, r.width - 260)), drag.dx + W - r.right);
      dy = Math.min(Math.max(dy, drag.dy - r.top), drag.dy + H - r.top - 48);
      move(box, dx, dy);
      if (!m.classList.contains('win-moved')) { m.classList.add('win-moved'); dock(); }
    });
    const end = () => { if (drag) { drag = null; m.classList.remove('win-moving'); } };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', (e) => { if (e.target.closest('button, input, select, textarea, a')) return; if (m.classList.contains('win-min')) return setMin(m, false); move(box, 0, 0); m.classList.remove('win-moved'); dock(); });
    // fenêtre réduite : un clic sur la barre la rouvre
    head.addEventListener('click', (e) => { if (m.classList.contains('win-min') && !e.target.closest('button')) setMin(m, false); });
    // à l'ouverture, la fenêtre revient en grand (à sa dernière position) ; à la fermeture, la barre disparaît
    new MutationObserver(() => { if (m.hidden && m.classList.contains('win-min')) { m.classList.remove('win-min'); const bb = m.querySelector('.win-min-btn'); if (bb) bb.textContent = '—'; } if (!m.hidden && !m.classList.contains('win-min')) box.style.transform = box.dataset.winT || ''; dock(); })
      .observe(m, { attributes: true, attributeFilter: ['hidden'] });
  }
  function init() { modals().forEach(enhance); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // le titre des fenêtres réduites est repris dans la barre (attribut pour les lecteurs d'écran)
  window.ForexiaWindows = { minimize: (id, on) => { const m = document.getElementById(id); if (m) setMin(m, on !== false); }, title: titleOf };
})();
