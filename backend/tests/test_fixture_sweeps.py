"""Every durable sweep kind must run cleanly on the complete browser fixture chain.

The pipeline's native-communication-dispatch step runs sweeps in child processes with
discarded stderr; this regression reproduces the same fixture data in-process so a failing
sweep surfaces its real traceback instead of an opaque bounded-job failure.
"""

import io
import json
import sys

from django.core.management import call_command
from django.test import TestCase, override_settings

SEEDS = (
    "seed_identity_examples",
    "seed_organization_examples",
    "seed_catalogue_examples",
    "seed_inventory_examples",
    "seed_marketplace_examples",
    "seed_messaging_examples",
    "seed_commerce_examples",
    "seed_negotiation_examples",
    "seed_payment_examples",
    "seed_fulfilment_examples",
)


class FixtureSweepTests(TestCase):
    # The seed commands require the disposable browser runtime (DEBUG=True, PRODUCTION=False),
    # exactly as the runner's browser-fixtures step provides via BROWSER_TEST_RUNTIME.
    @override_settings(DEBUG=True)
    def test_every_sweep_runs_on_browser_fixtures(self):
        values = {"password": "Fixture-Passw0rd-2026!", "phase": "phase-14-aftercare"}
        for command in SEEDS:
            sys.stdin = io.StringIO(json.dumps(values))
            call_command(command, stdin=True, verbosity=0)
        from apps.accounts.delivery import sweep_mail
        from apps.notifications.tasks import sweep_notifications
        from apps.catalogue.translations import dispatch as translation_dispatch
        from apps.payments.jobs import sweep as payment_sweep
        from apps.fulfilment.jobs import sweep as fulfilment_sweep
        from apps.notifications.aftercare_events import sweep as aftercare_sweep
        from apps.cart.services import expire_guests

        for sweep in (
            sweep_mail,
            sweep_notifications,
            translation_dispatch,
            payment_sweep,
            fulfilment_sweep,
            aftercare_sweep,
            expire_guests,
        ):
            with self.subTest(sweep=f"{sweep.__module__}.{sweep.__name__}"):
                sweep()