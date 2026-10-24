"""Bounded shutdown of native test process groups created by this interpreter."""

import os
import signal
import subprocess
import time
from typing import NamedTuple


class ProcessCleanupError(RuntimeError):
    pass


class ProcessInfo(NamedTuple):
    parent: int
    group: int
    state: str
    started: str


def process_snapshot():
    # Metadata only: never collect command lines or environment variables.
    output = subprocess.check_output(
        ["/bin/ps", "-axo", "pid=,ppid=,pgid=,stat=,lstart="], text=True, timeout=3
    )
    processes = {}
    for line in output.splitlines():
        pid, parent, group, state, started = line.split(None, 4)
        processes[int(pid)] = ProcessInfo(int(parent), int(group), state, started)
    return processes


def process_groups():
    groups = {}
    for pid, info in process_snapshot().items():
        groups.setdefault(info.group, {})[pid] = (info.state, info.started)
    return groups


class OwnedProcess(subprocess.Popen):
    """Remember group membership before reaping its leader; never adopt arbitrary PIDs."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **{**kwargs, "start_new_session": True})
        self._group_complete = False
        self._members = None
        # The child has not been waited/reaped: its PID cannot yet be reused.
        try:
            snapshot = process_snapshot()
            leader = snapshot.get(self.pid)
            if leader is None or leader.group != self.pid or self.pid == os.getpgrp():
                raise ProcessCleanupError("Could not establish the owned child session.")
            self._members = {self.pid: leader.started}
            self.live_members()
        except BaseException:
            # The freshly spawned, unreaped leader still reserves its PID/group.
            try:
                os.killpg(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            super().wait(timeout=5)
            raise

    @property
    def stopped(self):
        return self._group_complete

    def live_members(self):
        if self._group_complete:
            return set()
        snapshot = process_snapshot()
        leader = snapshot.get(self.pid)
        if leader and leader.started != self._members[self.pid]:
            raise ProcessCleanupError("Refusing a reused process group leader.")
        owned = {pid for pid, info in snapshot.items() if self._members.get(pid) == info.started}
        group = {pid for pid, info in snapshot.items() if info.group == self.pid}
        if group and not group.intersection(owned):
            raise ProcessCleanupError("Refusing a process group without an owned member.")
        owned.update(group)
        # Native servers may give children their own session/group. Retain their
        # identities while ancestry is observable, before waiting/reaping parents.
        while True:
            descendants = {pid for pid, info in snapshot.items() if info.parent in owned}
            if descendants.issubset(owned):
                break
            owned.update(descendants)
        self._current = {pid: snapshot[pid] for pid in owned}
        self._members.update({pid: info.started for pid, info in self._current.items()})
        return {pid for pid, info in self._current.items() if not info.state.startswith("Z")}

    def poll(self):
        if getattr(self, "_members", None) is not None:
            self.live_members()
        return super().poll()

    def wait(self, *args, **kwargs):
        if getattr(self, "_members", None) is not None:
            self.live_members()
        return super().wait(*args, **kwargs)

    def stop(self, timeout=5):
        if self._group_complete:
            return
        for signum in (signal.SIGTERM, signal.SIGKILL):
            live = self.live_members()
            if not live:
                break
            if any(self._current[pid].group == self.pid for pid in live):
                try:
                    os.killpg(self.pid, signum)
                except ProcessLookupError:
                    pass
            for pid in live:
                if self._current[pid].group == self.pid:
                    continue
                # Never signal another group wholesale: it may contain unrelated
                # processes. Recheck each retained descendant's identity instead.
                info = process_snapshot().get(pid)
                if info and info.started == self._members[pid] and not info.state.startswith("Z"):
                    try:
                        os.kill(pid, signum)
                    except ProcessLookupError:
                        pass
            deadline = time.monotonic() + timeout
            while self.live_members() and time.monotonic() < deadline:
                time.sleep(0.05)
        if self.live_members():
            raise ProcessCleanupError("Owned process group did not stop within its deadline.")
        super().wait(timeout=timeout)
        self._group_complete = True


def stop_process(process):
    if not isinstance(process, OwnedProcess):
        raise ProcessCleanupError("Refusing a process not created by the native test runner.")
    process.stop()
