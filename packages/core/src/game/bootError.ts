// The one screen that can appear before the HUD exists: the game could not connect, had no
// session, or its math could not be read. Self-contained (inline styles), blocking, and it says
// what to do — a boot must never fail into a black page.

export interface BootErrorOptions {
  title: string;
  message: string;
  /** Technical detail, shown small (errorId, URL, exception text). */
  detail?: string;
  /** Show a Reload button (default true). */
  reload?: boolean;
}

export function showBootError(opts: BootErrorOptions, host: HTMLElement = document.body): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.className = 'artubeplate-boot-error';
  root.style.cssText =
    'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(6,8,12,.92);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f2f4f8;';
  const card = document.createElement('div');
  card.style.cssText = 'max-width:420px;width:100%;background:#161a22;border:1px solid #2a3140;border-radius:16px;padding:24px 22px;box-shadow:0 20px 60px rgba(0,0,0,.5);text-align:center;';
  const h = document.createElement('h2');
  h.textContent = opts.title;
  h.style.cssText = 'margin:0 0 10px;font-size:20px;font-weight:700;letter-spacing:.2px;';
  const p = document.createElement('p');
  p.textContent = opts.message;
  p.style.cssText = 'margin:0 0 16px;font-size:15px;line-height:1.45;color:#c9d1de;';
  card.append(h, p);
  if (opts.detail) {
    const d = document.createElement('code');
    d.textContent = opts.detail;
    d.style.cssText = 'display:block;margin:0 0 16px;padding:8px 10px;border-radius:8px;background:#0e1117;color:#8b95a7;font-size:12px;word-break:break-word;text-align:left;';
    card.append(d);
  }
  if (opts.reload !== false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Reload';
    b.style.cssText = 'appearance:none;border:0;border-radius:999px;padding:11px 28px;font:600 15px system-ui,sans-serif;background:#2fd687;color:#04130b;cursor:pointer;';
    b.addEventListener('click', () => location.reload());
    card.append(b);
  }
  root.append(card);
  host.appendChild(root);
  return root;
}
