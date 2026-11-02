"""Actual native connection races, fencing and uncertain-provider recovery."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch, Mock
import signal
import subprocess
from django.core.management import call_command
from django.core.management.base import CommandError
from uuid import UUID, uuid4

from django.db import connection, connections, transaction, DatabaseError
from django.test import TestCase, TransactionTestCase, SimpleTestCase
from django.utils import timezone
from apps.runtime import jobs
from apps.runtime.models import Job, Scheduler
from config.environment import database_config


class TargetConfigurationTests(SimpleTestCase):
    def test_production_requires_protected_socket_or_verified_tls(self):
        from django.core.exceptions import ImproperlyConfigured
        for url in ('mariadb://u:p@db.example/db', 'mariadb://u:p@db.example/db?unix_socket=/tmp/mysql.sock',
                    'mariadb://u:p@localhost/db?unix_socket=relative', 'mariadb://u:p@localhost/db?ssl_ca=relative',
                    'mariadb://u:p@localhost/db?ssl_mode=DISABLED', 'mariadb://u:p@localhost/db?connect_timeout=20'):
            with self.subTest(case=url.split('?')[-1]), self.assertRaises(ImproperlyConfigured):
                database_config(url, production=True)
        local = database_config('mariadb://u:p%40ss@localhost/db?unix_socket=/var/lib/mysql/mysql.sock', production=True)
        self.assertEqual(local['PASSWORD'], 'p@ss')
        self.assertEqual(local['OPTIONS']['isolation_level'], 'read committed')
        remote = database_config('mariadb://u:p@db.example/db?ssl_ca=/private/ca.pem', production=True)
        self.assertEqual(remote['OPTIONS']['ssl_mode'], 'VERIFY_IDENTITY')


class DurableJobTests(TransactionTestCase):
    def thread(self, fn):
        def call():
            connections.close_all()
            try:
                return fn()
            finally:
                connections.close_all()
        return call

    def test_atomic_enqueue_and_rollback(self):
        with self.assertRaises(ValueError), transaction.atomic():
            jobs.enqueue('account_sweep')
            raise ValueError('Synthetic rollback')
        self.assertFalse(Job.objects.exists())
        one = jobs.enqueue('account_sweep')
        self.assertEqual(jobs.enqueue('account_sweep').pk, one.pk)
        self.assertEqual(Job.objects.count(), 1)

    def test_producer_first_sweep_keeps_its_required_recovery_schedule(self):
        row = jobs.enqueue('notice_sweep')
        self.assertEqual(row.period, jobs.SWEEPS['notice_sweep'])
        Job.objects.filter(pk=row.pk).update(period=0, state='done')
        jobs.seed_sweeps()
        row.refresh_from_db()
        self.assertEqual((row.period, row.state), (jobs.SWEEPS['notice_sweep'], 'queued'))
        row = jobs.claim()
        self.assertTrue(jobs.finish(row.pk, row.lease))
        row.refresh_from_db()
        self.assertEqual(row.state, 'queued')
        self.assertGreater(row.available_at, timezone.now())

    def test_wake_advances_scheduled_sweep_without_bypassing_retry_backoff(self):
        row = jobs.enqueue('notice_sweep', period=60)
        later = timezone.now() + timedelta(seconds=60)
        Job.objects.filter(pk=row.pk).update(available_at=later)
        jobs.enqueue('notice_sweep', wake=False)
        row.refresh_from_db()
        self.assertEqual(row.available_at, later)
        jobs.enqueue('notice_sweep')
        row.refresh_from_db()
        self.assertLessEqual(row.available_at, timezone.now())
        earlier = timezone.now() - timedelta(minutes=10)
        Job.objects.filter(pk=row.pk).update(available_at=earlier)
        jobs.enqueue('notice_sweep')
        row.refresh_from_db()
        self.assertEqual(row.available_at, earlier)
        Job.objects.filter(pk=row.pk).update(state='done', available_at=earlier)
        jobs.enqueue('notice_sweep')
        row.refresh_from_db()
        self.assertGreater(row.available_at, earlier + timedelta(minutes=9))
        Job.objects.filter(pk=row.pk).update(available_at=later, failures=1)
        jobs.enqueue('notice_sweep')
        row.refresh_from_db()
        self.assertEqual((row.available_at, row.failures), (later, 1))
        Job.objects.filter(pk=row.pk).update(state='failed', failures=5)
        jobs.enqueue('notice_sweep')
        row.refresh_from_db()
        self.assertEqual((row.state, row.failures), ('failed', 5))

    def test_budget_timeout_fences_job_and_releases_failed_scheduler(self):
        row = jobs.enqueue('notice_sweep')
        child = Mock(pid=987654)
        child.poll.return_value = None
        child.wait.side_effect = [subprocess.TimeoutExpired('synthetic-owned-child', 1), 0]
        with patch('apps.runtime.mariadb.schema.ready', return_value=True), patch('apps.runtime.mariadb.schema.verify'), \
             patch('apps.runtime.management.commands.run_due_jobs.subprocess.Popen', return_value=child), \
             patch('apps.runtime.management.commands.run_due_jobs.os.killpg') as terminate:
            with self.assertRaises(CommandError):
                call_command('run_due_jobs', seconds=5, limit=1, verbosity=0)
        terminate.assert_called_once_with(child.pid, signal.SIGKILL)
        row.refresh_from_db()
        self.assertEqual((row.state, row.failures, row.lease), ('queued', 1, None))
        self.assertGreater(row.available_at, timezone.now())
        scheduler = Scheduler.objects.get(pk='cron')
        self.assertIsNone(scheduler.lease)
        self.assertEqual(scheduler.error_code, 'runner_failed')
        self.assertFalse(jobs.scheduler_ready())

    def test_independent_claim_skips_a_locked_job(self):
        one, two = jobs.enqueue('account_sweep'), jobs.enqueue('notice_sweep')
        with transaction.atomic():
            Job.objects.select_for_update().get(pk=one.pk)
            with ThreadPoolExecutor(max_workers=1) as pool:
                row = pool.submit(self.thread(jobs.claim)).result(timeout=10)
                self.assertEqual(row.pk, two.pk)
        self.assertNotEqual(jobs.claim().lease, row.lease)

    def test_expired_claim_recovery_fences_old_completion(self):
        jobs.enqueue('account_sweep')
        old = jobs.claim()
        Job.objects.filter(pk=old.pk).update(lease_until=timezone.now()-timedelta(seconds=1))
        self.assertFalse(jobs.finish(old.pk,old.lease))
        new = jobs.claim()
        self.assertEqual(new.attempts,2)
        self.assertNotEqual(old.lease,new.lease)
        self.assertFalse(jobs.finish(old.pk,old.lease))
        self.assertTrue(jobs.finish(new.pk,new.lease))
        self.assertFalse(jobs.finish(new.pk,new.lease))

    def test_singleton_real_connection_race_and_expiry(self):
        barrier=Barrier(2)
        def compete():
            barrier.wait(timeout=10)
            return jobs.acquire_scheduler()
        with ThreadPoolExecutor(max_workers=2) as pool:
            values=list(pool.map(lambda _:self.thread(compete)(),range(2)))
        self.assertEqual(sum(v is not None for v in values),1)
        old=next(v for v in values if v)
        Scheduler.objects.update(lease_until=timezone.now()-timedelta(seconds=1))
        new=jobs.acquire_scheduler()
        self.assertFalse(jobs.release_scheduler(old))
        self.assertTrue(jobs.release_scheduler(new))

    def test_bounded_retry_backoff_and_failure_visibility(self):
        jobs.enqueue('account_sweep')
        for attempt in range(1,6):
            row=jobs.claim()
            self.assertIsNotNone(row)
            self.assertTrue(jobs.finish(row.pk,row.lease,failed=True))
            row.refresh_from_db()
            self.assertEqual(row.failures,attempt)
            self.assertGreater(row.available_at,timezone.now())
            self.assertIsNone(jobs.claim())
            if attempt<5:
                Job.objects.filter(pk=row.pk).update(available_at=timezone.now())
        self.assertEqual(row.state,'failed')
        Scheduler.objects.create(name='cron',completed_at=timezone.now())
        with patch('apps.runtime.mariadb.schema.ready',return_value=True):
            self.assertFalse(jobs.scheduler_ready())

    def test_lag_is_truthful_for_failed_queued_and_abandoned_work(self):
        Scheduler.objects.create(name='cron',completed_at=timezone.now())
        with patch('apps.runtime.mariadb.schema.ready',return_value=True):
            self.assertTrue(jobs.scheduler_ready())
            row=jobs.enqueue('account_sweep')
            Job.objects.filter(pk=row.pk).update(available_at=timezone.now()-timedelta(minutes=6))
            self.assertFalse(jobs.scheduler_ready())
            Job.objects.filter(pk=row.pk).update(state='running',lease=uuid4(),lease_until=timezone.now()-timedelta(minutes=6))
            self.assertFalse(jobs.scheduler_ready())


class UncertainMailTests(TestCase):
    def setUp(self):
        from apps.accounts.models import User
        self.user=User.objects.create_user('durable-mail@example.test','Synthetic-Password-1234',display_name='Synthetic')

    @patch('apps.accounts.delivery.EmailMultiAlternatives.send',side_effect=TimeoutError('Synthetic uncertain acknowledgement'))
    def test_unknown_acknowledgement_never_blindly_retries(self,send):
        from apps.accounts.delivery import queue_account_mail,sweep_mail
        from apps.accounts.models import AccountMail
        queue_account_mail(self.user,'verify','en')
        self.assertEqual(send.call_count,0)
        sweep_mail()
        row=AccountMail.objects.get()
        self.assertEqual((row.status,row.attempts),('delivery_unknown',1))
        for _ in range(3):
            AccountMail.objects.filter(pk=row.pk).update(next_attempt_at=timezone.now()-timedelta(minutes=10))
            sweep_mail()
        self.assertEqual(send.call_count,1)
        AccountMail.objects.update(expires_at=timezone.now()-timedelta(seconds=1))
        sweep_mail()
        row.refresh_from_db()
        self.assertEqual(row.encrypted_payload,'')

    @patch('apps.accounts.delivery.EmailMultiAlternatives.send')
    def test_crash_after_persisted_dispatch_boundary_is_unknown(self,send):
        from apps.accounts.delivery import queue_account_mail,sweep_mail
        from apps.accounts.models import AccountMail
        queue_account_mail(self.user,'verify','en')
        AccountMail.objects.update(status='dispatching',attempts=1,next_attempt_at=timezone.now()-timedelta(seconds=1))
        sweep_mail()
        self.assertEqual(AccountMail.objects.get().status,'delivery_unknown')
        send.assert_not_called()


@skipUnless(connection.vendor=='mysql','MariaDB hex UUID storage contract')
class NativeIdentifierTests(TestCase):
    def test_mixed_uuid_versions_preserve_unsigned_byte_order_and_validation(self):
        from apps.accounts.models import User
        values=[UUID('00000001-0000-1000-8000-ffffffffffff'),UUID('ffffffff-0000-1000-8000-000000000001'),UUID('00000002-0000-4000-8000-000000000001')]
        for index,value in enumerate(values):
            User.objects.create(id=value,email=f'uuid{index}@example.test',display_name='Synthetic')
        self.assertEqual(list(User.objects.filter(pk__in=values).order_by('pk').values_list('pk',flat=True)),sorted(values))
        with self.assertRaises(DatabaseError),transaction.atomic(),connection.cursor() as cursor:
            cursor.execute('UPDATE accounts_user SET id=%s WHERE id=%s',['malformed',values[0].hex])


class TypedTransferTests(SimpleTestCase):
    def test_json_scalar_null_and_large_numeric_lexemes_are_exact(self):
        from apps.runtime.transfer import encode, decode
        for vendor in ("postgresql", "mysql"):
            for raw in ('{"amount":12345678901234567890.123456789}', '"scalar"', 'null', '[true,false,null,"fa-AF"]'):
                with self.subTest(vendor=vendor, raw=raw):
                    packed=encode(raw,"JSONField",vendor)
                    self.assertEqual(decode(packed,"JSONField"),raw)
                    self.assertNotEqual(packed,None)
            self.assertIsNone(encode(None,"JSONField",vendor))
            self.assertIsNone(decode(None,"JSONField"))

    def test_native_backup_omits_only_approved_derived_columns(self):
        from apps.runtime.transfer import export_columns, TransferError
        kinds = {"example": {"id": "UUIDField", "email": "EmailField"}}
        derived = [["example", "email_normalized", "lcase(email)"]]
        self.assertEqual(export_columns("example", ["id", "email", "email_normalized"], kinds,
                                        vendor="mysql", generated=derived), ["id", "email"])
        for columns in (["id", "email", "unexpected"], ["id", "email"], ["id", "email_normalized"]):
            with self.subTest(columns=columns), self.assertRaises(TransferError):
                export_columns("example", columns, kinds, vendor="mysql", generated=derived)

    def test_native_declarations_match_frozen_initial_contract(self):
        from apps.runtime.mariadb import common
        from apps.runtime.mariadb.schema import statements
        from apps.cart.mariadb_guards import statements as cart
        from apps.messaging.mariadb_guards import statements as messaging
        from apps.notifications.mariadb_guards import statements as notices
        from apps.orders.mariadb_guards import statements as orders
        expected=[*common.uuid_statements(),*common.statements(),*common.store_statements(),*cart(),*messaging(),*notices(),*orders(),
            "CREATE TABLE runtime_guardprobe (nonce CHAR(32) PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin"]
        self.assertEqual(statements(),expected)
