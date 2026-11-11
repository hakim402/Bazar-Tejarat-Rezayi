"""English, owner-only Site Setting tasks and paginated homepage media libraries."""
from django.contrib import messages
from django.contrib.admin.helpers import AdminErrorList, InlineAdminForm, InlineAdminFormSet
from django.template.response import TemplateResponse
from django.templatetags.static import static
from django.utils.html import format_html, format_html_join
from unfold.admin import ModelAdmin, StackedInline
from unfold.forms import AdminForm
from django.conf import settings
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.paginator import Paginator
from django.db import DatabaseError
from django.db.models import Q
from django.http import Http404
from django.shortcuts import render, redirect, get_object_or_404
from django.urls import path, reverse
from django.utils.translation import gettext_lazy as _
from django.utils.decorators import method_decorator
from django.views.decorators.http import require_http_methods
from rest_framework.exceptions import APIException
from apps.accounts.admin import owner_site
from apps.accounts.services import get_grant
from apps.organizations.admin import ReadOnlyAdmin
from .models import SiteSettings, HeroSlide, PageSEO, SiteDraft, SiteMedia, SiteLocale, HeroLocale, SiteDraftUpload
from .forms import SettingsForm, SEOForm, SEOForms, PostForm, MediaLibraryFilterForm
from .sections import SECTION_MAP
from .services import save_settings
from .workspace import draft_for, save_post, delete_post, save_section_draft


def settings_urls(admin_site):
    editor = admin_site._registry[SiteSettings]
    return [
        path('site-setting/', admin_site.admin_view(editor.legacy), name='site_settings'),
        path('site-setting/hero/', admin_site.admin_view(editor.editor), {'section': 'hero'}, name='site_hero'),
        path('site-setting/<slug:section>/new/', admin_site.admin_view(editor.post_editor), name='site_post_add'),
        path('site-setting/<slug:section>/<uuid:pk>/delete/', admin_site.admin_view(editor.post_delete), name='site_post_delete'),
        path('site-setting/<slug:section>/<uuid:pk>/', admin_site.admin_view(editor.post_editor), name='site_post_edit'),
        path('site-setting/<slug:section>/', admin_site.admin_view(editor.editor), name='site_settings_section'),
        path('settings/', admin_site.admin_view(editor.legacy), name='site_settings_old'),
        path('settings/<slug:section>/', admin_site.admin_view(editor.legacy), name='site_settings_old_section'),
    ]


class SEOInline(StackedInline):
    model = PageSEO
    form = SEOForm
    fields = ['page', 'locale', 'title', 'description', 'image_file']
    verbose_name = _('Page override')
    verbose_name_plural = _('Individual page overrides (optional)')
    show_change_link = False
    view_on_site = False


class SEOAdminFormSet(InlineAdminFormSet):
    def __iter__(self):
        # Native queryset zipping can hide submitted rows deleted by another editor.
        for index, form in enumerate(self.formset.forms):
            yield InlineAdminForm(
                self.formset, form, self.fieldsets, self.prepopulated_fields,
                form.instance if index < self.formset.initial_form_count() else None,
                self.readonly_fields, model_admin=self.opts,
            )
        yield InlineAdminForm(
            self.formset, self.formset.empty_form, self.fieldsets,
            self.prepopulated_fields, None, self.readonly_fields, model_admin=self.opts,
        )


class SiteAdmin(ReadOnlyAdmin):
    def render_editor(self, request, form, fieldsets, context, *, readonly_fields=(), seo=None, media_section=False):
        form_admin = ModelAdmin(form._meta.model, self.admin_site)
        if media_section:
            form_admin.change_form_outer_after_template = 'site/library.html'
        inline_formsets = []
        media = form_admin.media + form.media
        if seo is not None:
            inline = SEOInline(SiteSettings, self.admin_site)
            inline_formset = SEOAdminFormSet(
                inline, seo, [(None, {'fields': inline.fields})], model_admin=form_admin,
            )
            inline_formsets.append(inline_formset)
            media += inline_formset.media
        form_admin.warn_unsaved_form = True
        request.current_app = self.admin_site.name
        return TemplateResponse(request, 'admin/change_form.html', {
            **context,
            'adminform': AdminForm(form, fieldsets, {}, readonly_fields, model_admin=form_admin),
            'opts': form._meta.model._meta, 'original': str(context['title']),
            'add': False, 'change': True, 'is_popup': False, 'save_as': False,
            'has_add_permission': False, 'has_change_permission': False,
            'has_delete_permission': False, 'has_view_permission': True,
            'has_editable_inline_admin_formsets': False,
            'show_save': False, 'show_save_and_continue': False, 'show_save_and_add_another': False,
            'show_history': False, 'show_view_on_site': False,
            'has_file_field': form.is_multipart(), 'inline_admin_formsets': inline_formsets,
            'errors': AdminErrorList(form, [seo] if seo is not None else []),
            'media': media, 'scripts': [static('site/settings.js')], 'form_classes': {},
            'actions_submit_line': [
                {'action_name': 'save_draft', 'description': _('Save draft'), 'attrs': {'name': 'action', 'value': 'save_draft', 'formnovalidate': True}},
                {'action_name': 'publish', 'description': _('Publish'), 'attrs': {'name': 'action', 'value': 'publish'}},
            ],
        })

    def localized_fieldsets(self, form):
        fieldsets, readonly_fields = [], []
        for tab in form.localized_tabs():
            fields = [field.name for field in tab['fields']]
            if getattr(form, 'section', None) and form.section.logos:
                def current_logos(obj, tab=tab):
                    return format_html(
                        '<div class="flex flex-wrap gap-4"><div class="bg-white border border-base-200 p-3 rounded-default">'
                        '<img src="{}" alt="{}" class="h-12 max-w-48 object-contain"></div>'
                        '<div class="bg-base-900 p-3 rounded-default"><img src="{}" alt="{}" class="h-12 max-w-48 object-contain"></div></div>',
                        reverse('site_media', kwargs={'pk': tab['logo_light'].pk}) if tab['logo_light'] else static(tab['logo_light_static']),
                        _('Current logo for light backgrounds'),
                        reverse('site_media', kwargs={'pk': tab['logo_dark'].pk}) if tab['logo_dark'] else static(tab['logo_dark_static']),
                        _('Current logo for dark backgrounds'),
                    )
                current_logos.short_description = _('Logos by language')
                readonly_fields.append(current_logos)
                fields.insert(0, current_logos)
            fieldsets.append((tab['caption'], {
                'fields': fields, 'classes': ('tab',),
                'description': _('Start with Dari. Other languages are optional and fall back to Dari when blank.')
                if tab['code'] == 'fa-AF' and not getattr(getattr(form, 'section', None), 'logos', False) else '',
            }))
        return fieldsets, readonly_fields

    def get_urls(self):
        return [path('', self.admin_site.admin_view(self.legacy), name='site_settings_legacy'), path('hero/', self.admin_site.admin_view(self.legacy), {'section': 'hero'}, name='site_hero_legacy'), *super().get_urls()]

    @method_decorator(require_http_methods(['GET']))
    def legacy(self, request, section='general'):
        self.context(request, 'Site Setting')
        return redirect(reverse('admin:site_settings_section', kwargs={'section': section}))

    def context(self, request, title):
        try:
            get_grant(request, 'owner')
        except APIException:
            raise PermissionDenied from None
        return {**self.admin_site.each_context(request), 'title': title}

    @method_decorator(require_http_methods(['GET', 'POST']))
    def editor(self, request, section):
        context = self.context(request, _('Site Setting'))
        if section not in SECTION_MAP:
            raise Http404
        selected = SECTION_MAP[section]
        try:
            instance = SiteSettings.objects.prefetch_related('locales').get(pk=1)
        except SiteSettings.DoesNotExist:
            return render(request, 'site/uninitialized.html', context, status=503)
        draft = SiteDraft.objects.filter(settings=instance, section=section).first()
        if request.method == 'POST':
            data = request.POST
        elif draft:
            data = {**draft.form_data, 'site-version': instance.version}
        else:
            data = None
        form = SettingsForm(data, request.FILES or None, instance=instance, prefix='site', section=selected)
        seo = SEOForms(data, request.FILES or None, queryset=PageSEO.objects.filter(settings=instance), prefix='seo') if section == 'seo' else None
        if request.method == 'POST':
            action = request.POST.get('action')
            valid = [editor.is_valid() for editor in [form, seo] if editor is not None]
            if not all(valid):
                form.add_error(None, _('Settings not saved'))
            if action not in {'save_draft', 'publish'}:
                form.add_error(None, _('Choose Save draft or Publish.'))
            elif all(valid):
                try:
                    if action == 'save_draft':
                        save_section_draft(request, form, seo)
                        messages.success(request, _('Draft saved. The public website is unchanged.'))
                    else:
                        save_settings(request, form, seo=seo)
                        messages.success(request, _('Published. Changes apply to the next public request.'))
                    return redirect(reverse('admin:site_settings_section', kwargs={'section': section}))
                except ValidationError as error:
                    form.add_error(None, error)
                except (OSError, DatabaseError):
                    form.add_error(None, _('Changes could not be saved. Your text is retained; re-select new uploads and retry.'))
        media_section = section in {'hero', 'promotions'}
        posts = None
        library_rows = []
        if media_section:
            queryset = HeroSlide.objects.filter(settings=instance, placement='main' if section == 'hero' else 'promotion', draft_of__isnull=True).select_related('image', 'poster', 'pending_draft').order_by('-updated_at', 'id')
            query = request.GET.get('q', '').strip()[:80]
            if query:
                queryset = queryset.filter(label__icontains=query)
            kind = request.GET.get('kind', '')
            if kind in {'image', 'video'}:
                queryset = queryset.filter(kind=kind)
            status = request.GET.get('status', '')
            if status == 'draft':
                queryset = queryset.filter(Q(is_draft=True) | Q(pending_draft__isnull=False))
            elif status == 'published':
                queryset = queryset.filter(is_draft=False)
            posts = Paginator(queryset, 24).get_page(request.GET.get('page'))
            for post in posts:
                post.has_draft = getattr(post, 'pending_draft', None) is not None
                post.selected = post.pk in {instance.promotion_one_id, instance.promotion_two_id}
                edit_url = reverse('admin:site_post_edit', kwargs={'section': section, 'pk': post.pk})
                asset_id = post.poster_id if post.kind == 'video' else post.image_id
                thumbnail = reverse('site_media', kwargs={'pk': asset_id}) if asset_id else f'{settings.FRONTEND_ORIGIN}/images/marketplace/hero.webp' if post.bundled_image else ''
                preview = format_html('<img src="{}" alt="" class="h-12 w-16 object-contain" loading="lazy">', thumbnail) if thumbnail else ''
                state = _('Draft') if post.is_draft else _('Published · draft changes') if post.has_draft else _('Published · hidden') if not post.enabled else _('Published')
                library_rows.append([
                    format_html('<a href="{}" class="flex items-center gap-3 text-primary-600"><span>{}</span><span>{}</span></a>', edit_url, preview, post.label),
                    post.get_kind_display(), state, _('Selected for homepage') if post.selected else '—', post.updated_at,
                    format_html('<div class="flex gap-3"><a href="{}" class="text-primary-600">{}</a><a href="{}" class="text-red-600">{}</a></div>', edit_url, _('Edit'), reverse('admin:site_post_delete', kwargs={'section': section, 'pk': post.pk}), _('Delete')),
                ])
        draft_note = _('You are editing a saved draft. The public version stays unchanged until you publish.') if draft else _('Save a draft to prepare changes privately, or publish to update the public website.')
        fields = [field.name for field in form.core_fields()]
        if section == 'contacts':
            fieldsets = [
                (_('Public support details'), {'fields': ['version', 'email', 'phone', 'website'], 'description': draft_note}),
                (_('Social links (optional)'), {'fields': ['facebook', 'instagram', 'linkedin', 'youtube']}),
            ]
        else:
            fieldsets = [(selected.title, {'fields': ['version', *fields], 'description': draft_note})]
        localized, readonly_fields = self.localized_fieldsets(form)
        if section == 'branding' and instance.favicon_id:
            readonly_fields.append(self.favicon_preview)
            fieldsets[0][1]['fields'].append(self.favicon_preview)
        if section == 'seo' and instance.og_image_id:
            readonly_fields.append(self.sharing_preview)
            fieldsets[0][1]['fields'].append(self.sharing_preview)
        fieldsets.extend(localized)
        if draft and draft.uploads.exists():
            def draft_images(obj):
                return format_html_join('', '<figure><img src="{}" alt="" class="h-24 max-w-full object-contain"><figcaption><bdi>{}</bdi></figcaption></figure>', (
                    (reverse('site_media', kwargs={'pk': upload.asset_id}), upload.field)
                    for upload in draft.uploads.select_related('asset')
                ))
            draft_images.short_description = _('Saved draft images')
            readonly_fields.append(draft_images)
            fieldsets.append((_('Saved draft images'), {
                'fields': [draft_images],
                'description': _('These uploads are retained for publication. Upload a replacement to change them.'),
            }))
        return self.render_editor(request, form, fieldsets, {
            **context, 'title': selected.title, 'selected': selected, 'form': form,
            'instance': instance, 'draft': draft,
            'posts': posts, 'library_filters': MediaLibraryFilterForm(request.GET),
            'media_table': {'headers': [_('Internal name'), _('Media type'), _('Status'), _('Selected for homepage'), _('Updated at'), _('Actions')], 'rows': library_rows},
        }, readonly_fields=readonly_fields, seo=seo, media_section=media_section)

    def media_section(self, section):
        if section not in {'hero', 'promotions'}:
            raise Http404
        return 'main' if section == 'hero' else 'promotion'

    @method_decorator(require_http_methods(['GET', 'POST']))
    def post_editor(self, request, section, pk=None):
        placement = self.media_section(section)
        context = self.context(request, _('Edit homepage media') if pk else _('Add homepage media'))
        site = get_object_or_404(SiteSettings, pk=1)
        root = get_object_or_404(HeroSlide, pk=pk, settings=site, placement=placement, draft_of__isnull=True) if pk else HeroSlide(settings=site, placement=placement, is_draft=True, enabled=True, label='')
        working = draft_for(root) if pk else root
        publish = request.method == 'POST' and request.POST.get('action') == 'publish'
        form = PostForm(request.POST or None, request.FILES or None, instance=working, prefix='post', initial={'version': site.version}, promotion=placement == 'promotion', publishing=publish)
        if request.method == 'POST' and form.is_valid():
            if request.POST.get('action') not in {'save_draft', 'publish'}:
                form.add_error(None, _('Choose Save draft or Publish.'))
            else:
                try:
                    result = save_post(request, form, root, placement, publish=publish)
                    messages.success(request, _('Published successfully.') if publish else _('Draft saved. The public version is unchanged.'))
                    return redirect(reverse('admin:site_post_edit', kwargs={'section': section, 'pk': result.pk}))
                except ValidationError as error:
                    form.add_error(None, error)
                except (OSError, DatabaseError):
                    form.add_error(None, _('The post could not be saved. Re-select new uploads and retry.'))
        fieldsets = [
            (_('Post details'), {
                'fields': [field.name for field in form.hidden_fields()] + [field.name for field in form.basics()],
                'description': _('Save draft keeps your work private. Publish updates the public version. Videos show no visible headline or button; clicking opens their source destination.'),
            }),
            (_('Image or video'), {
                'fields': [field.name for field in [*form.image_fields(), *form.video_fields()]] + ['image_url', 'video_url'],
                'description': _('Images: PNG, JPEG or WebP, up to 8 MiB. Videos: H.264 MP4, up to 50 MiB and 60 seconds. An uploaded video gets a poster automatically; you can upload your own poster instead.'),
            }),
        ]
        localized, readonly_fields = self.localized_fieldsets(form)
        if working.image_id or working.video_id or working.bundled_image:
            readonly_fields.append(self.media_preview)
            fieldsets[1][1]['fields'].append(self.media_preview)
        fieldsets.extend(localized)
        return self.render_editor(request, form, fieldsets, {
            **context, 'form': form, 'root': root, 'working': working, 'section': section,
            'actions_detail': [{
                'title': _('Back to library'), 'path': reverse('admin:site_settings_section', kwargs={'section': section}),
                'icon': 'arrow_back',
            }] + ([{
                'title': _('Delete permanently'),
                'path': reverse('admin:site_post_delete', kwargs={'section': section, 'pk': root.pk}),
                'icon': 'delete',
            }] if pk else []),
        }, readonly_fields=readonly_fields)

    def favicon_preview(self, obj):
        return format_html('<img src="{}" alt="{}" class="h-16 max-w-full object-contain">', reverse('site_media', kwargs={'pk': obj.favicon_id}), _('Current website icon'))

    favicon_preview.short_description = _('Current website icon')

    def sharing_preview(self, obj):
        return format_html('<img src="{}" alt="{}" class="h-32 max-w-full object-contain">', reverse('site_media', kwargs={'pk': obj.og_image_id}), _('Current social preview image'))

    sharing_preview.short_description = _('Current social preview image')

    def media_preview(self, obj):
        if obj.kind == 'video' and obj.video_id:
            return format_html('<video controls preload="metadata" src="{}" poster="{}" class="max-h-80 max-w-full rounded-default"></video>', reverse('site_media', kwargs={'pk': obj.video_id}), reverse('site_media', kwargs={'pk': obj.poster_id}) if obj.poster_id else '')
        src = reverse('site_media', kwargs={'pk': obj.image_id}) if obj.image_id else f'{settings.FRONTEND_ORIGIN}/images/marketplace/hero.webp'
        return format_html('<img src="{}" alt="{}" class="max-h-64 max-w-full object-contain">', src, _('Current image'))

    media_preview.short_description = _('Current image')

    @method_decorator(require_http_methods(['GET', 'POST']))
    def post_delete(self, request, section, pk):
        placement = self.media_section(section)
        context = self.context(request, _('Delete homepage media'))
        root = get_object_or_404(HeroSlide, pk=pk, settings_id=1, placement=placement, draft_of__isnull=True)
        error = ''
        if request.method == 'POST':
            try:
                if request.POST.get('confirm') != 'delete':
                    raise ValidationError('Confirm permanent deletion to continue.')
                retired = delete_post(request, root, request.POST.get('version', '0'))
                if SiteMedia.objects.filter(pk__in=retired, pending_delete=True).exists():
                    messages.warning(request, _('Post deleted. Some unused files could not be removed yet; cleanup is pending.'))
                else:
                    messages.success(request, _('Post permanently deleted. Exclusive uploaded files were removed; shared files remain available to other content.'))
                return redirect(reverse('admin:site_settings_section', kwargs={'section': section}))
            except (ValidationError, ValueError) as failure:
                error = str(failure)
        return render(request, 'site/delete.html', {**context, 'root': root, 'section': section, 'error': error, 'version': SiteSettings.objects.get(pk=1).version})


owner_site.register(SiteSettings, SiteAdmin)


class SiteRecordAdmin(ReadOnlyAdmin):
    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def settings_workflow(self, obj):
        from django.utils.html import format_html
        section = getattr(obj, 'section', 'general')
        if obj._meta.model_name in {'heroslide', 'herolocale'}:
            section = 'hero'
        if obj._meta.model_name == 'pageseo':
            section = 'seo'
        return format_html('<a href="{}">Open validated Site Settings</a>', reverse('admin:site_settings_section', kwargs={'section': section}))


class SiteLocaleAdmin(SiteRecordAdmin):
    fields = ['settings', 'locale', 'name', 'tagline', 'description', 'settings_workflow']
    list_display = ['locale', 'name']


class SEOAdmin(SiteRecordAdmin):
    fields = ['settings', 'page', 'locale', 'title', 'description', 'image', 'settings_workflow']
    list_display = ['page', 'locale', 'title']
    list_filter = ['locale', 'page']


class HeroAdmin(SiteRecordAdmin):
    fields = ['settings', 'label', 'placement', 'is_draft', 'draft_of', 'enabled', 'kind', 'updated_at', 'settings_workflow']
    list_display = ['label', 'placement', 'is_draft', 'enabled', 'kind']
    list_filter = ['placement', 'is_draft', 'enabled']
    search_fields = ['label']


class HeroLocaleAdmin(SiteRecordAdmin):
    fields = ['slide', 'locale', 'title', 'description', 'alt', 'cta_label', 'cta_url', 'transcript', 'settings_workflow']
    list_display = ['slide', 'locale', 'title']
    list_filter = ['locale']


class MediaMetadataAdmin(SiteRecordAdmin):
    fields = ['kind', 'content_type', 'size', 'width', 'height', 'duration', 'has_audio', 'pending_delete', 'settings_workflow']
    list_display = ['id', 'kind', 'size', 'width', 'height', 'pending_delete']
    list_filter = ['kind', 'pending_delete']


class DraftAdmin(SiteRecordAdmin):
    fields = ['settings', 'section', 'updated_at', 'settings_workflow']
    list_display = ['section', 'updated_at']


class DraftUploadAdmin(SiteRecordAdmin):
    fields = ['draft', 'field', 'asset', 'settings_workflow']
    list_display = ['draft', 'field', 'asset']


owner_site.register(SiteLocale, SiteLocaleAdmin)
owner_site.register(PageSEO, SEOAdmin)
owner_site.register(HeroSlide, HeroAdmin)
owner_site.register(HeroLocale, HeroLocaleAdmin)
owner_site.register(SiteMedia, MediaMetadataAdmin)
owner_site.register(SiteDraft, DraftAdmin)
owner_site.register(SiteDraftUpload, DraftUploadAdmin)
