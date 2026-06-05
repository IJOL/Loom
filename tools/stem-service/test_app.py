import time
from jobs import JobRegistry


def fake_separate(in_path, out_dir):
    return {"vocals": "/tmp/v.wav", "drums": "/tmp/d.wav",
            "bass": "/tmp/b.wav", "other": "/tmp/o.wav"}


def test_job_runs_to_done():
    reg = JobRegistry(separate=fake_separate)
    job_id = reg.create(in_path="/tmp/in.wav", out_dir="/tmp/out")
    # poll until terminal (runner is a background thread)
    for _ in range(50):
        job = reg.get(job_id)
        if job.status in ("done", "error"):
            break
        time.sleep(0.02)
    job = reg.get(job_id)
    assert job.status == "done"
    assert set(job.stems.keys()) == {"vocals", "drums", "bass", "other"}


def test_job_error_is_captured():
    def boom(in_path, out_dir):
        raise RuntimeError("model download failed")
    reg = JobRegistry(separate=boom)
    job_id = reg.create(in_path="/tmp/in.wav", out_dir="/tmp/out")
    for _ in range(50):
        if reg.get(job_id).status in ("done", "error"):
            break
        time.sleep(0.02)
    job = reg.get(job_id)
    assert job.status == "error"
    assert "model download failed" in job.error
