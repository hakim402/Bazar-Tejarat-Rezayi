"""Curated destinations derived from the freshly authorized native model directory."""
from urllib.parse import urlencode
from django.urls import reverse
from django.utils.translation import gettext_lazy as _


def navigation(request):
    from .admin import owner_site
    from .admin_access import is_owner
    from apps.site.sections import SECTIONS
    root = is_owner(request)
    available = {model['model']._meta.label_lower: model for app in owner_site.get_app_list(request) for model in app['models']}

    def entry(title, icon, model, filters=None):
        record = available.get(model)
        if not record or not record.get('admin_url'):
            return None
        return {'title': _(title), 'icon': icon, 'link': record['admin_url'] + ('?' + urlencode(filters) if filters else '')}

    groups = [
        ('overview', 'Overview', [{'title': _('Overview'), 'icon': 'space_dashboard', 'link': reverse('admin:index')}]),
        ('access', 'Accounts & Access', [
            entry('Users', 'group', 'accounts.user'),
            entry('Buyer accounts', 'person', 'accounts.account', {'context__exact': 'buyer'}),
            entry('Seller accounts', 'storefront', 'accounts.account', {'context__exact': 'seller'}),
            entry('Staff accounts', 'manage_accounts', 'accounts.account', {'context__exact': 'staff'}),
            entry('Roles & Permissions', 'groups', 'auth.group')]),
        ('business', 'Businesses & Verification', [
            entry('Business profiles', 'business', 'organizations.businessprofile'),
            entry('Company teams', 'groups', 'organizations.membership'),
            entry('Verification cases', 'verified_user', 'verification.reviewcase'),
            entry('Ownership transfers', 'swap_horiz', 'organizations.ownershiptransfer')]),
        ('catalogue', 'Catalogue', [
            entry('Products', 'inventory_2', 'catalogue.product'),
            entry('Source review', 'fact_check', 'catalogue.sourcerevision', {'state__exact': 'submitted'}),
            entry('Translation review', 'translate', 'catalogue.translation'),
            entry('Categories', 'category', 'catalogue.category'),
            entry('Sale units', 'straighten', 'catalogue.saleunit'),
            entry('Product media', 'image', 'catalogue.productimage')]),
        ('stores', 'Marketplace & Stores', [
            entry('Public stores', 'store', 'marketplace.store'),
            entry('Store reviews', 'fact_check', 'marketplace.storerevision'),
            entry('Featured Rezayi store', 'star', 'marketplace.featuredstore'),
            entry('Store media', 'image', 'marketplace.storemedia')]),
        ('inventory', 'Inventory', [
            entry('Stock positions', 'inventory', 'inventory.position'),
            entry('Batches', 'package_2', 'inventory.batch'),
            entry('Movements', 'history', 'inventory.movement'),
            entry('Allocations', 'checklist', 'inventory.allocation'),
            entry('Shortages', 'warning', 'inventory.shortage'),
            entry('Recovery records', 'restore', 'inventory.recovery')]),
        ('commerce', 'Orders & Invoices', [entry('Formal requests', 'request_quote', 'orders.negotiation'), entry('Accepted orders', 'receipt_long', 'orders.sellerorder'), entry('Goods invoices', 'description', 'orders.invoice'), entry('Advance due policy', 'schedule', 'orders.orderpolicy')]),
        ('payments', 'Payments & Review', [entry('Goods payment review', 'fact_check', 'payments.reviewcase'), entry('Confirmed receipts', 'payments', 'payments.receipt'), entry('Payment claims', 'receipt', 'payments.claim'), entry('Receipt corrections', 'edit_document', 'payments.correction'), entry('Reservation plans', 'inventory', 'payments.stockplan'), entry('Allocation attempts', 'history', 'payments.allocationattempt')]),
        ('communication', 'Communication', [
            entry('Message reports', 'forum', 'messaging.report'),
            entry('Communication delivery', 'mail', 'notifications.outbox')]),
        ('system', 'System Records', [
            entry('Audit activity', 'history', 'accounts.auditevent'),
            entry('Mail delivery', 'mail', 'accounts.accountmail'),
            entry('Invitation delivery', 'mail', 'organizations.invitationmail'),
            entry('Translation jobs', 'translate', 'catalogue.translationjob'),
            entry('Browser access', 'security', 'accounts.browserauthority'),
            entry('Authenticators', 'shield', 'accounts.authenticator')]),
    ]
    if root:
        groups.append(('settings', 'Site Settings', [
            {'title': section.title, 'icon': section.icon,
             'link': reverse('admin:site_settings_section', kwargs={'section': section.key})} for section in SECTIONS]))
    result = [{'key': key, 'title': _(title), 'collapsible': key != 'overview', 'items': [item for item in items if item]} for key, title, items in groups]
    result = [group for group in result if group['items']]
    # Resolve filtered siblings deliberately; Unfold's path-prefix default would
    # highlight all three account entries for a single selected account context.
    from urllib.parse import urlsplit, parse_qs
    for group in result:
        for item in group['items']:
            target = urlsplit(item['link'])
            expected = parse_qs(target.query)
            path_matches = request.path == target.path or target.path != reverse('admin:index') and request.path.startswith(target.path)
            item['active'] = bool(path_matches and all(request.GET.getlist(k) == v for k, v in expected.items()))
    return result
