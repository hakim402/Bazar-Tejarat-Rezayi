// Live control visibility for the settings and post editors (native Unfold rows).
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('sitesettings_form') || document.getElementById('heroslide_form');
  if (!form) return;
  const post = form.id === 'heroslide_form';
  form.parentElement.dataset.testid = post ? 'site-post-editor' : 'site-settings-editor';

  // Hide the whole row, but never hide a row that is showing a validation error.
  function show(name, visible) {
    const input = form.elements.namedItem(name);
    const row = input?.closest('.form-row');
    if (row) row.hidden = !visible && !row.querySelector('.errorlist');
  }

  function mediaControls() {
    // Image and video controls are mutually exclusive on the post editor.
    const kind = form.elements.namedItem('kind')?.value;
    if (kind) {
      for (const name of ['bundled_image', 'image_file', 'clear_image', 'image_url']) show(name, kind === 'image');
      for (const name of ['video_file', 'poster_file', 'source_url', 'silent', 'clear_video', 'video_url']) show(name, kind === 'video');
      for (const input of form.elements) {
        const name = input.name || '';
        if (/^[a-z]{2}(-[A-Z]{2})?_(title|description|cta_label|cta_url)$/.test(name)) show(name, kind === 'image');
        if (/^[a-z]{2}(-[A-Z]{2})?_transcript$/.test(name)) show(name, kind === 'video');
      }
    }
    // Promotions are always included once published; carousel order does not apply.
    const placement = form.elements.namedItem('placement')?.value;
    if (placement) {
      show('enabled', placement !== 'promotion');
      show('position', placement !== 'promotion');
    }
    // Hero layout controls follow the selected carousel mode.
    const mode = form.elements.namedItem('hero_mode')?.value;
    if (mode) {
      const carousel = mode.includes('carousel');
      show('hero_autoplay', mode.includes('video'));
      show('hero_rotate', carousel);
      show('hero_interval', carousel && form.elements.namedItem('hero_rotate').checked);
    }
  }

  mediaControls();
  form.addEventListener('change', mediaControls);
  const error = form.querySelector('.errornote') || document.querySelector('.errornote');
  if (error) {
    error.setAttribute('tabindex', '-1');
    error.focus();
  }
});