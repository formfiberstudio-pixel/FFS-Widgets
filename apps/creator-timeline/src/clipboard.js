// Copying inside a Notion embed (an iframe Notion controls, not us) can
// fail two different ways: the async Clipboard API silently rejects if
// the iframe wasn't granted clipboard-write permission, AND -- this is
// the one that also breaks the old fallback -- browsers block
// window.alert/confirm/prompt from firing at all inside a cross-origin
// iframe, so a prompt()-based fallback shows nothing and just returns
// null instantly. Fall through clipboard -> execCommand -> a fallback
// that's just our own DOM (an overlay we render ourselves), which can't
// be blocked the same way since it doesn't call any restricted browser API.
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (ok) return true;
  } catch {
    // fall through to the last resort
  }

  showManualCopyOverlay(text);
  return false;
}

// Everything above requires a browser API that a restrictive iframe can
// block. This doesn't -- it's plain DOM we create and control ourselves,
// so it renders regardless of clipboard or dialog permissions. Built with
// raw DOM (not React) so this utility works from anywhere without needing
// a component tree to mount into.
function showManualCopyOverlay(text) {
  document.getElementById('__ct_copy_overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '__ct_copy_overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const box = document.createElement('div');
  box.style.cssText = 'background:#171717;color:#f5f5f5;border-radius:10px;padding:16px;max-width:440px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,0.4);';

  const label = document.createElement('div');
  label.textContent = "Couldn't copy automatically here. Select the text below and press Ctrl+C (or Cmd+C):";
  label.style.cssText = 'font-size:13px;line-height:1.4;margin-bottom:10px;';

  const input = document.createElement('input');
  input.readOnly = true;
  input.value = text;
  input.style.cssText = 'width:100%;padding:8px 10px;border-radius:6px;border:1px solid #404040;background:#0a0a0a;color:#f5f5f5;font-family:ui-monospace,monospace;font-size:12px;box-sizing:border-box;';
  input.onclick = () => input.select();

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'margin-top:12px;padding:6px 14px;border-radius:6px;border:none;background:#f43f5e;color:#fff;font-weight:bold;font-size:13px;cursor:pointer;';
  closeBtn.onclick = () => overlay.remove();

  box.append(label, input, closeBtn);
  overlay.append(box);
  document.body.append(overlay);

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}
