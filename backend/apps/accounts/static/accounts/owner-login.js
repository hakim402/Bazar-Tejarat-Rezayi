// Match Unfold's appearance preference without reading identity or session storage.
(() => {
  const preferred = window.matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    let theme = 'auto';
    try { theme = JSON.parse(localStorage.getItem('adminTheme') || '"auto"'); } catch { /* System preference still works. */ }
    document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'auto' && preferred.matches));
  }
  apply();
  preferred.addEventListener('change', apply);
})();
