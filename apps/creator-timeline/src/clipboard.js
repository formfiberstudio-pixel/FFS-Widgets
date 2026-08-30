// Copying inside a Notion embed (an iframe Notion controls, not us) can
// silently fail via the async Clipboard API if the iframe wasn't granted
// clipboard-write permission -- navigator.clipboard.writeText just rejects
// and the caller's catch swallows it, so the button looks like it did
// nothing. Fall back through progressively more compatible (but uglier)
// approaches instead of giving up quietly.
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

  // Script-driven copying is blocked entirely (common in a restrictive
  // Notion iframe) -- a prompt's text field is still selectable and
  // copyable by the user with Ctrl+C even though we can't do it for them.
  try {
    window.prompt('Copy this link:', text);
  } catch {
    // ignore -- nothing more we can do
  }
  return false;
}
