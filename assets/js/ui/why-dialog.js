// Bilingual "Why contribute?" dialog. The text itself is in index.html.
import { $ } from '../lib/dom.js';
import { load, save } from '../lib/storage.js';
import { me } from '../osm/session.js';

const why = $('why'), whyIn = why.querySelector('.why-in');
let getStats = () => null;

function setLang(lang) {
  whyIn.dataset.lang = lang;
  why.querySelectorAll('[data-set-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.setLang === lang));
  save(localStorage, 'tngf_lang', lang);
}

function renderLive() {
  const m = me(), s = getStats();
  let ta, en;
  if (s && s.named_total) {
    const cov = (100 * (s.named_total - s.missing_ta) / s.named_total).toFixed(1);
    ta = `நீங்கள் பார்த்த பகுதியில் உள்ள <b>${s.named_total}</b> இடங்களில் <b>${s.missing_ta}</b> இடங்களுக்கு இன்னும் தமிழ்ப் பெயர் இல்லை. தமிழ்ப் பெயர் உள்ளவை <b>${cov}%</b> மட்டுமே.`;
    en = `In the area you scanned, <b>${s.missing_ta}</b> of <b>${s.named_total}</b> named places still have no Tamil name. Tamil coverage is only <b>${cov}%</b>.`;
  } else {
    ta = 'உங்கள் தெருவை ஸ்கேன் செய்து பாருங்கள், எத்தனை இடங்களுக்குத் தமிழ்ப் பெயர் இல்லை என்று தெரியும்.';
    en = 'Scan your own street to see how many places still need a Tamil name.';
  }
  if (m.logged_in && m.edits > 0 && !m.dry_run) {
    ta += ` இதுவரை நீங்கள் <b>${m.edits}</b> பெயர்கள் சேர்த்துள்ளீர்கள். நன்றி! 🙏`;
    en += ` You've added <b>${m.edits}</b> name${m.edits === 1 ? '' : 's'} so far. Thank you! 🙏`;
  }
  $('whyLive').innerHTML = `<span class="ta">${ta}</span><span class="en">${en}</span>`;
  $('whyLogin').hidden = !(m.configured && !m.logged_in);
}

export function openWhy() {
  renderLive();
  why.showModal();
}

export function openWhyOnFirstVisit() {
  if (!load(localStorage, 'tngf_seen_why', false)) openWhy();
}

/** `statsFn` returns the last scan's stats (or null) for the live numbers. */
export function initWhyDialog(statsFn) {
  getStats = statsFn;
  why.querySelectorAll('[data-set-lang]').forEach(b => b.onclick = () => setLang(b.dataset.setLang));
  setLang(load(localStorage, 'tngf_lang', 'ta'));
  $('whyBtn').onclick = openWhy;
  $('whyStart').onclick = () => why.close();
  why.addEventListener('click', e => { if (e.target === why) why.close(); });   // click backdrop to close
  why.addEventListener('close', () => save(localStorage, 'tngf_seen_why', true));
}
