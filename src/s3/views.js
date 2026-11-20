// Shell panels: the Sources drawer (every citation and what the on-page labels mean) and the keyboard help.
// The SRR's requirement, scenario and function-flow views live in the SRR repo; requirements are on their own site.
import SOURCES from '../../analysis/data/sources.json';
import { ICON } from '../icons.js';

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const closeBtn = `<button class="p-close icon-btn" data-act="close" title="Close (Esc)" aria-label="Close panel">${ICON.close}</button>`;
const head = (eyebrow, title, extra = '') => `${closeBtn}<div class="p-eyebrow">${eyebrow}</div><h2 class="p-title">${title}</h2>${extra}`;

// ---------- sources drawer ----------
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
export function sourcesPanel() {
  const list = Object.values(SOURCES.sources);
  const label = (cls, text, what) => `<li><span class="${cls}">${text}</span><span>${what}</span></li>`;
  return `
    ${head(`<span>Sources</span><i></i><span>${list.length} cited</span>`, 'Sources and labels')}
    <p class="p-text">${esc(SOURCES._note)} Requirement text and numbers come from the RFP S-3 class document.
      Equipment prices and their sources are in the Trades tab's Catalog.</p>
    <h3 class="p-h">What the labels mean</h3>
    <ul class="src-labels">
      ${label('vtag is-assume', 'Assumption', 'A planning value we chose. Not sourced; open to change.')}
      ${label('vtag is-proxy', 'Modeled proxy', 'Placed or computed by a rule because the real data is not in hand yet.')}
      ${label('vtag is-baseline', 'Notional baseline', 'The architecture we drew to size things. The trade study is pending.')}
      ${label('vtag is-published', 'Published', 'A public price or figure from the vendor or trade press, with its source.')}
      ${label('vtag is-estimate', 'Estimate', 'Our engineering estimate, with the reasoning given.')}
      ${label('tbr', 'TBR', 'To be resolved: a proposed allocation or open item, not a requirement.')}
    </ul>
    <h3 class="p-h">Cited sources</h3>
    <ol class="src-list">${list.map(s => `<li><span>${esc(s.title)}</span>${s.url
      ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(host(s.url))}<span class="sr-only"> (opens in a new tab)</span></a>` : ''}</li>`).join('')}</ol>`;
}

// ---------- help ----------
export function helpView() {
  const rows = [
    ['1 – 3', 'Research · Design · Trades'], ['→ &nbsp;PgDn &nbsp;Space', 'Next step: Why → Today → S-3 system → who must hear it → how far a voice carries (clickers work)'], ['← &nbsp;PgUp', 'Previous step'],
    ['P', 'Presenter mode'], ['H', 'Slide mode: hide the top bar for screenshots'], ['L', 'Light / dark theme'], ['S', 'Sources'], ['F', 'Fullscreen'],
    ['Esc', 'Close panel'], ['?', 'This help'],
  ];
  return `<div class="help-head"><span>Keyboard</span><button class="icon-btn" data-act="help" aria-label="Close shortcuts">${ICON.close}</button></div>
    <dl>${rows.map(([k, v]) => `<dt>${k.split(' &nbsp;').map(x => `<kbd>${x}</kbd>`).join('')}</dt><dd>${v}</dd>`).join('')}</dl>`;
}
