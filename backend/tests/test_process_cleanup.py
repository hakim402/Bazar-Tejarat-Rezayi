"""Real synthetic process trees and artifact failures must not leak native services."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

from django.test import SimpleTestCase

from scripts.processes import OwnedProcess, ProcessCleanupError, ProcessInfo, process_groups, stop_process
from scripts.run_tests import TestFailure, TestRun


class NativeProcessCleanupTests(SimpleTestCase):
    def sleeping_process(self):
        process = OwnedProcess([sys.executable, "-c", "import time;time.sleep(60)"])
        self.addCleanup(process.stop, 0.2)
        return process

    def tree(self, *, new_session=False):
        child = (
            "import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);"
            "print('ready',flush=True);time.sleep(60)"
        )
        parent = (
            "import subprocess,sys,time;"
            f"p=subprocess.Popen([sys.executable,'-c',{child!r}],stdout=subprocess.PIPE,text=True,"
            f"start_new_session={new_session!r});"
            "p.stdout.readline();print(p.pid,flush=True);"
            "sys.stdin.readline()"
        )
        process = OwnedProcess([sys.executable, "-c", parent], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, text=True)
        self.addCleanup(process.stop, 0.2)
        self.addCleanup(process.stdout.close)
        self.addCleanup(process.stdin.close)
        child_pid = int(process.stdout.readline())
        process.live_members()
        return process, child_pid

    def test_stubborn_descendant_is_killed_after_parent_exits_on_term(self):
        process, child = self.tree()
        process.stop(timeout=0.2)
        self.assertTrue(process.stopped)
        self.assertNotIn(child, process.live_members())
        self.assertFalse(any(not row[0].startswith("Z")
                             for row in process_groups().get(process.pid, {}).values()))

    def test_already_reaped_parent_still_has_its_owned_descendants_stopped(self):
        process, child = self.tree()
        process.stdin.write("exit\n")
        process.stdin.flush()
        process.wait(timeout=3)
        self.assertIn(child, process.live_members())
        process.stop(timeout=0.2)
        self.assertTrue(process.stopped)

    def test_completed_group_is_never_signalled_again(self):
        process = self.sleeping_process()
        process.stop(timeout=0.2)
        with patch("scripts.processes.os.killpg") as send:
            process.stop(timeout=0.2)
        send.assert_not_called()

    def test_descendant_in_a_separate_session_is_stopped_after_parent_exit(self):
        process, child = self.tree(new_session=True)
        process.stdin.write("exit\n")
        process.stdin.flush()
        process.wait(timeout=3)
        self.assertIn(child, process.live_members())
        process.stop(timeout=0.2)
        self.assertTrue(process.stopped)
        self.assertFalse(any(not row[0].startswith("Z")
                             for row in process_groups().get(child, {}).values()))

    def test_reused_leader_and_unowned_handles_are_refused(self):
        process = self.sleeping_process()
        for snapshot in ({process.pid: ProcessInfo(1, process.pid, "S", "different-start-identity")},
                         {process.pid + 1: ProcessInfo(1, process.pid, "S", "unrelated-member")}):
            with patch("scripts.processes.process_snapshot", return_value=snapshot), \
                    patch("scripts.processes.os.killpg") as send:
                with self.assertRaises(ProcessCleanupError):
                    process.stop(timeout=0.2)
                send.assert_not_called()
        with self.assertRaises(ProcessCleanupError):
            stop_process(object())

    def make_run(self, root):
        run = TestRun.__new__(TestRun)
        run.evidence = root
        run.generated = {}
        run.password = "synthetic"
        run.frontend = run.frontend_log = None
        run.dist = "owned-test-output"
        run.dist_owned = True
        run.tsconfig = '{"include":[]}'
        run.next_env = None
        run.logs = []
        run.acquired = True
        run.runtime = root / "owned-runtime"
        run.runtime.mkdir()
        run.marker = {"run_id": "synthetic-owned"}
        (run.runtime / "ownership.json").write_text(json.dumps(run.marker))
        run.processes = [self.sleeping_process(), self.sleeping_process()]
        return run

    def test_malformed_config_still_stops_servers_and_removes_owned_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tsconfig.json").write_text("{invalid")
            run = self.make_run(root)
            with patch("scripts.run_tests.FRONTEND", root), self.assertRaises(TestFailure):
                run.cleanup()
            self.assertTrue(all(p.stopped for p in run.processes))
            self.assertFalse(run.runtime.exists())
            result = json.loads((root / "cleanup.json").read_text())
            self.assertTrue(result["owned_process_groups_exited"])
            self.assertEqual(result["errors"], [{"step": "restore-typescript-config", "error": "JSONDecodeError"}])
            self.assertEqual((root / "tsconfig.json").read_text(), "{invalid")

    def test_one_stop_error_does_not_skip_other_servers_or_delete_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = self.make_run(root)
            run.dist_owned = False
            failed, remaining = reversed(run.processes)
            original = run.stop_process

            def fail_one(process):
                if process is failed:
                    raise ProcessCleanupError("synthetic teardown failure")
                original(process)

            with patch.object(run, "stop_process", side_effect=fail_one), self.assertRaises(TestFailure):
                run.cleanup()
            self.assertTrue(remaining.stopped)
            self.assertFalse(failed.stopped)
            self.assertTrue(run.runtime.exists())
            result = json.loads((root / "cleanup.json").read_text())
            self.assertFalse(result["owned_process_groups_exited"])
            self.assertFalse(result["owned_directory_removed"])

    def test_wrong_directory_marker_is_preserved_after_servers_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = self.make_run(root)
            run.dist_owned = False
            (run.runtime / "ownership.json").write_text('{"run_id":"unrelated"}')
            with self.assertRaises(TestFailure):
                run.cleanup()
            self.assertTrue(all(p.stopped for p in run.processes))
            self.assertTrue(run.runtime.exists())
            result = json.loads((root / "cleanup.json").read_text())
            self.assertEqual(result["errors"], [{"step": "remove-runtime", "error": "TestFailure"}])

    def test_failed_cleanup_is_recorded_even_when_original_task_also_failed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tsconfig.json").write_text('{"include":[]}')
            run = self.make_run(root)
            run.identifier = "synthetic-cleanup-failure"
            run.phase = "phase-06-catalogue"
            run.browser_spec = None
            run.backend_only = False

            def corrupt_and_fail():
                (root / "tsconfig.json").write_text("{invalid")
                raise TestFailure("Intentional verification failure.")

            with patch("scripts.run_tests.ROOT", root), patch("scripts.run_tests.FRONTEND", root), \
                    patch.object(run, "source_manifest", return_value={}), \
                    patch.object(run, "prepare"), patch.object(run, "backend_checks", side_effect=corrupt_and_fail), \
                    self.assertRaises(TestFailure):
                run.execute()
            self.assertEqual(json.loads((root / "result.json").read_text())["status"], "cleanup_failed")
            self.assertTrue(all(p.stopped for p in run.processes))
            self.assertFalse(run.runtime.exists())
