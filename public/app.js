// Shared helpers across public/team/hq pages — keeps the three dashboards
// consistent instead of drifting apart, and avoids repeating the same
// fetch/error/chart logic three times.

const REFRESH_MS = 120000; // auto-refresh every 2 min — cheap, and lets a
// dashboard left open on a shared screen stay current without a manual reload.

async function fetchTier(endpoint, passphrase) {
  const url = passphrase ? `${endpoint}?p=${encodeURIComponent(passphrase)}` : endpoint;
  const resp = await fetch(url);
  if (resp.status === 403) return { ok: false, forbidden: true };
  if (!resp.ok) return { ok: false, forbidden: false };
  return { ok: true, data: await resp.json() };
}

function showError(container, message, onRetry) {
  container.innerHTML = '';
  const banner = document.createElement('div');
  banner.className = 'error-banner';
  banner.innerHTML = `<span>${message}</span>`;
  const btn = document.createElement('button');
  btn.className = 'small';
  btn.textContent = 'Retry';
  btn.onclick = onRetry;
  banner.appendChild(btn);
  container.appendChild(banner);
}

function skeletonCards(container, n) {
  container.innerHTML = Array.from({ length: n }, () => '<div class="card skeleton skeleton-card"></div>').join('');
}

function renderBarList(entries, opts = {}) {
  const { max, colorClass = '' } = opts;
  const top = max ? entries.slice(0, max) : entries;
  const highest = Math.max(1, ...top.map(([, n]) => n));
  return top
    .map(
      ([label, n]) => `
      <div class="bar-row">
        <div class="bar-label" title="${label}">${label}</div>
        <div class="bar-track"><div class="bar-fill ${colorClass}" style="width:${Math.round((n / highest) * 100)}%"></div></div>
        <div class="bar-value">${n}</div>
      </div>`
    )
    .join('');
}

function formatFreshness(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `Last updated: ${d.toLocaleString()}`;
}

function toCSV(rows) {
  return rows.map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

function downloadCSV(filename, rows) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Reusable passphrase gate for team.html / hq.html — handles the prompt,
// session persistence, and retry so those pages just supply a render callback.
function initGate({ storeKey, endpoint, gateEl, protectedEl, inputEl, errEl, onRender }) {
  async function attempt(passphrase) {
    const result = await fetchTier(endpoint, passphrase);
    if (!result.ok) return false;
    onRender(result.data);
    return true;
  }

  window.__gateUnlock = async () => {
    const p = inputEl.value;
    const ok = await attempt(p);
    if (ok) {
      sessionStorage.setItem(storeKey, p);
      gateEl.style.display = 'none';
      if (protectedEl) protectedEl.style.display = 'block';
      startAutoRefresh(() => attempt(p));
    } else {
      errEl.textContent = 'Incorrect passphrase.';
    }
  };

  const saved = sessionStorage.getItem(storeKey);
  if (saved) {
    attempt(saved).then((ok) => {
      if (ok) {
        gateEl.style.display = 'none';
        if (protectedEl) protectedEl.style.display = 'block';
        startAutoRefresh(() => attempt(saved));
      } else {
        sessionStorage.removeItem(storeKey);
      }
    });
  }
}

function startAutoRefresh(reloadFn) {
  setInterval(reloadFn, REFRESH_MS);
}

function lockAndReload(storeKey) {
  sessionStorage.removeItem(storeKey);
  location.reload();
}

function toast(msg) {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast';
    t.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#354062;color:#fff;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.25);z-index:999;opacity:0;transition:opacity .25s';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 1800);
}
