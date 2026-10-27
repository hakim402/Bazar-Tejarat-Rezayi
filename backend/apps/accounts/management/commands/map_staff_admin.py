"""Explicit legacy-role activation; default is a non-mutating UUID-only diff."""
import json
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from apps.accounts.models import Account, AuditEvent


class Command(BaseCommand):
    help = 'Dry-run legacy staff role mapping. --activate ACCOUNT_UUID --apply explicitly activates one identity.'

    def add_arguments(self, parser):
        parser.add_argument('--activate')
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        if options['apply'] and not options['activate']:
            raise CommandError('Choose one staff account with --activate; blanket activation is forbidden.')
        with transaction.atomic():
            rows = Account.objects.select_for_update().filter(context='staff').select_related('user').order_by('pk')
            if options['activate']:
                rows = rows.filter(pk=options['activate'])
                if not rows.exists():
                    raise CommandError('Staff account not found.')
            for account in rows:
                user = account.user
                legacy = set(account.permission_groups.values_list('pk', flat=True))
                current = set(user.groups.values_list('pk', flat=True))
                safe = (account.status == 'active' and user.is_active and user.email_verified
                        and not user.owner_authority and not user.is_superuser and (not current or current == legacy))
                self.stdout.write(json.dumps({'account': str(account.pk), 'legacy_groups': sorted(legacy),
                    'current_groups': sorted(current), 'would_enable_admin': not user.is_staff,
                    'eligible': safe, 'apply': options['apply']}))
                if options['apply']:
                    if not safe:
                        raise CommandError('Inactive/unverified/privileged identity or conflicting canonical roles; review manually.')
                    changed = not user.is_staff or current != legacy
                    if changed:
                        user.groups.set(legacy)
                        user.is_staff = True
                        user.save(update_fields=['is_staff'])
                        AuditEvent.objects.create(subject=user, account=account, context="system",
                            action="staff_admin_legacy_activated", changed_fields=["is_staff", "groups"],
                            state={"source": "explicit_management_command", "legacy_groups": sorted(legacy),
                                   "canonical_groups": sorted(legacy)})
