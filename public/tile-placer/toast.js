// toast.js — small "pops up" confirmation banner, used after a
// drag-and-drop (or bad-file) load so it's obvious something happened.

let stack = 0;

export function showToast(message, { error = false, duration = 2800 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' toast-error' : '');
  el.textContent = message;
  el.style.bottom = `${20 + stack * 44}px`;
  document.body.appendChild(el);
  stack++;

  requestAnimationFrame(() => el.classList.add('show'));

  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.remove();
      stack = Math.max(0, stack - 1);
    }, 250);
  }, duration);
}
