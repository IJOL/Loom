"""In-memory job registry with a background thread runner. Separation is injected
so tests can stub it (never runs real Demucs in CI)."""
from __future__ import annotations
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

SeparateFn = Callable[[str, str], dict[str, str]]


@dataclass
class Job:
    id: str
    in_path: str
    out_dir: str
    status: str = "queued"          # queued | running | done | error
    progress: Optional[float] = None  # 0..1 or None (indeterminate)
    stems: dict[str, str] = field(default_factory=dict)  # stem -> wav path
    error: str = ""
    created_at: float = field(default_factory=time.time)


class JobRegistry:
    def __init__(self, separate: SeparateFn, ttl_sec: float = 3600.0):
        self._separate = separate
        self._ttl = ttl_sec
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, in_path: str, out_dir: str) -> str:
        job = Job(id=uuid.uuid4().hex, in_path=in_path, out_dir=out_dir)
        with self._lock:
            self._gc_locked()
            self._jobs[job.id] = job
        threading.Thread(target=self._run, args=(job.id,), daemon=True).start()
        return job.id

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def delete(self, job_id: str) -> bool:
        with self._lock:
            return self._jobs.pop(job_id, None) is not None

    def _run(self, job_id: str) -> None:
        job = self.get(job_id)
        if job is None:
            return
        job.status = "running"
        try:
            stems = self._separate(job.in_path, job.out_dir)
            job.stems = stems
            job.status = "done"
            job.progress = 1.0
        except Exception as exc:  # noqa: BLE001 — surface any failure to the client
            job.error = str(exc)
            job.status = "error"

    def _gc_locked(self) -> None:
        now = time.time()
        stale = [jid for jid, j in self._jobs.items() if now - j.created_at > self._ttl]
        for jid in stale:
            self._jobs.pop(jid, None)
