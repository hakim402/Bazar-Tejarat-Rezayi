document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('sitesettings_form') || document.getElementById('heroslide_form');
  if (!form) return;
  const post = form.id === 'heroslide_form';
  const prefix = post ? 'post' : 'site';
  form.parentElement.dataset.testid = post ? 'site-post-editor' : 'site-settings-editor';

  function show(name, visible) {
    const input = form.elements.namedItem(`${prefix}-${name}`);
    const row = input?.closest('.form-row');
    if (row) row.hidden = !visible && !row.querySelector('.errorlist');
  }

  function mediaControls() {
    const kind = form.elements.namedItem('post-kind')?.value;
    if (kind) {
      for (const name of ['bundled_image', 'image_file', 'clear_image', 'image_url']) show(name, kind === 'image');
      for (const name of ['video_file', 'poster_file', 'source_url', 'silent', 'clear_video', 'video_url']) show(name, kind === 'video');
      for (const input of form.elements) {
        if (!input.name?.startsWith('post-')) continue;
        const name = input.name.slice(5);
        if (/_(title|description|cta_label|cta_url)$/.test(name)) show(name, kind === 'image');
        if (name.endsWith('_transcript')) show(name, kind === 'video');
      }
    }
    const mode = form.elements.namedItem('site-hero_mode')?.value;
    if (mode) {
      const carousel = mode.includes('carousel');
      show('hero_autoplay', mode.includes('video'));
      show('hero_rotate', carousel);
      show('hero_interval', carousel && form.elements.namedItem('site-hero_rotate').checked);
    }
  }

  mediaControls();
  form.addEventListener('change', mediaControls);
  const error = form.querySelector('.errornote');
  if (error) {
    error.setAttribute('tabindex', '-1');
    error.focus();
  }
});
