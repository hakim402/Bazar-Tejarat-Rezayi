"""English, owner-only Site Setting tasks and paginated homepage media libraries."""
from django.contrib import messages
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
from .models import SiteSettings, HeroSlide, PageSEO, SiteDraft, SiteMedia
from .forms import SettingsForm, SEOForms, PostForm
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


class SiteAdmin(ReadOnlyAdmin):
    def get_urls(self):
        return [path('', self.admin_site.admin_view(self.legacy), name='site_settings_legacy'), path('hero/', self.admin_site.admin_view(self.legacy), {'section': 'hero'}, name='site_hero_legacy'), *super().get_urls()]

    @method_decorator(require_http_methods(['GET']))
    def legacy(self, request, section='general'):
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
        return render(request, 'site/settings.html', {
            **context, 'title': selected.title, 'selected': selected, 'form': form, 'seo': seo,
            'instance': instance, 'fields': form.core_fields(), 'language_tabs': form.localized_tabs(),
            'draft': draft, 'draft_uploads': draft.uploads.select_related('asset') if draft else [],
            'contact_fields': [form[name] for name in ['email', 'phone', 'website']] if section == 'contacts' else [],
            'social_fields': [form[name] for name in ['facebook', 'instagram', 'linkedin', 'youtube']] if section == 'contacts' else [],
            'frontend_origin': settings.FRONTEND_ORIGIN, 'posts': posts, 'media_section': media_section, 'q': request.GET.get('q', ''),
        })

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
        return render(request, 'site/post.html', {**context, 'form': form, 'editor': form, 'root': root, 'working': working, 'section': section, 'promotion': placement == 'promotion', 'is_existing': bool(pk)})

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
