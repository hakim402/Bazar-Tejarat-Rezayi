/* Local presentation only. All validation/permissions/version checks remain server-side. */
(() => {
  const form = document.getElementById('site-settings-form');
  if (!form) return;
  function tabs(root) {
    root.querySelectorAll('[data-locale-group]').forEach(group => {
      const buttons = [...group.querySelectorAll(':scope > [role="tablist"] > button')];
      const panels = [...group.querySelectorAll(':scope > [role="tabpanel"]')];
      function select(index, focus = false) {
        buttons.forEach((button, i) => { button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1; panels[i].hidden = i !== index; });
        if (focus) buttons[index].focus();
      }
      buttons.forEach((button, i) => {
        button.addEventListener('click', () => select(i));
        button.addEventListener('keydown', event => {
          if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
            event.preventDefault();
            select(event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length, true);
          }
        });
      });
      const invalid = panels.findIndex(panel => panel.querySelector('.errorlist'));
      select(invalid < 0 ? 0 : invalid);
    });
  }
  tabs(form);
  function reveal(element) {
    let details = element.closest('details');
    while (details) { details.open = true; details = details.parentElement.closest('details'); }
    element.closest('[data-field]')?.removeAttribute('hidden');
    element.closest('[data-media-kind]')?.removeAttribute('hidden');
    const panel = element.closest('[role="tabpanel"]');
    if (panel) document.getElementById(panel.getAttribute('aria-labelledby'))?.click();
  }
  function mediaControls(root) {
    root.querySelectorAll('[data-slide-editor]').forEach(slide => {
      const kind = slide.querySelector('[name$="-kind"]').value;
      slide.querySelectorAll('[data-media-kind]').forEach(group => { group.hidden = group.dataset.mediaKind !== kind && !group.querySelector('.errorlist'); });
      slide.querySelectorAll('[data-field]').forEach(group => {
        if (group.dataset.field.endsWith('_transcript')) group.hidden = kind !== 'video' && !group.querySelector('.errorlist');
        if (group.dataset.field.endsWith('_alt')) group.hidden = kind !== 'image' && !group.querySelector('.errorlist');
      });
      slide.querySelector('[data-slide-label]').textContent = slide.querySelector('[name$="-label"]').value || 'New slide';
      slide.querySelector('[data-slide-state]').textContent = `${slide.querySelector('[name$="-enabled"]').checked ? 'Enabled' : 'Draft'} · Edit slide`;
    });
    const postKind = form.elements.namedItem('post-kind')?.value;
    if (postKind) {
      form.querySelectorAll('[data-media-kind]').forEach(group => { group.hidden = group.dataset.mediaKind !== postKind && !group.querySelector('.errorlist'); });
      form.querySelectorAll('[data-locale-group] [data-field]').forEach(group => {
        const name = group.dataset.field;
        const hidden = postKind === 'video' ? /_(title|description|cta_label|cta_url)$/.test(name) : name.endsWith('_transcript');
        group.hidden = hidden && !group.querySelector('.errorlist');
      });
    }
    const mode = form.elements.namedItem('site-hero_mode')?.value;
    if (mode) {
      const carousel = mode.includes('carousel'), video = mode.includes('video');
      for (const [field, visible] of [['hero_autoplay', video], ['hero_rotate', carousel], ['hero_interval', carousel && form.elements.namedItem('site-hero_rotate').checked]]) {
        const group = form.querySelector(`[data-field="${field}"]`);
        group.hidden = !visible && !group.querySelector('.errorlist');
      }
    }
  }
  mediaControls(form);
  form.addEventListener('change', () => mediaControls(form));
  form.addEventListener('input', event => {
    if (event.target.name.endsWith('-label')) mediaControls(form);
  });
  form.addEventListener('invalid', event => {
    reveal(event.target);
  }, true);
  form.querySelectorAll('.errorlist').forEach(error => reveal(error));
  form.querySelector('[data-error-summary]')?.focus();
  document.querySelectorAll('[data-add-form]').forEach(button => button.addEventListener('click', () => {
    const prefix = button.dataset.addForm;
    const count = form.elements.namedItem(`${prefix}-TOTAL_FORMS`);
    const maximum = Number(form.elements.namedItem(`${prefix}-MAX_NUM_FORMS`).value);
    const index = Number(count.value);
    if (index >= maximum) { button.disabled = true; return; }
    const fragment = document.getElementById(prefix === 'slides' ? 'slide-empty' : 'seo-empty').content.cloneNode(true);
    fragment.querySelectorAll('*').forEach(node => {
      for (const attr of ['id','name','for','aria-controls','aria-labelledby']) {
        if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr).replaceAll('__prefix__', String(index)));
      }
    });
    const wrapper = document.createElement('div'); wrapper.append(fragment); tabs(wrapper); wrapper.querySelector("details")?.setAttribute("open", "");
    document.getElementById(prefix === 'slides' ? 'slide-forms' : 'seo-forms').append(wrapper);
    mediaControls(wrapper);
    wrapper.querySelector('input:not([type="hidden"]), select, textarea')?.focus();
    count.value = String(index + 1); form.dispatchEvent(new Event('change'));
  }));
  let dirty = false, submitting = false;
  form.addEventListener('change', () => { dirty = true; document.getElementById('site-save-state').textContent = 'Unsaved changes'; });
  form.addEventListener('input', () => { dirty = true; document.getElementById('site-save-state').textContent = 'Unsaved changes'; });
  form.addEventListener('submit', () => { submitting = true; });
  window.addEventListener('beforeunload', event => { if (dirty && !submitting) { event.preventDefault(); event.returnValue = ''; } });
})();
