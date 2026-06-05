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


import io
import app as app_module
from fastapi.testclient import TestClient


def _client_with_stub(monkeypatch):
    # Stub separation so no real Demucs runs; write tiny wav files on demand.
    import os, tempfile

    def fake_separate(in_path, out_dir):
        os.makedirs(out_dir, exist_ok=True)
        out = {}
        for stem in ("vocals", "drums", "bass", "other"):
            p = os.path.join(out_dir, f"{stem}.wav")
            with open(p, "wb") as f:
                f.write(b"RIFF....WAVEfmt ")  # not a valid wav; only the bytes matter for the test
            out[stem] = p
        return out

    app_module.registry._separate = fake_separate  # type: ignore[attr-defined]
    return TestClient(app_module.app)


def test_health(monkeypatch):
    client = _client_with_stub(monkeypatch)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_post_job_then_poll_to_done(monkeypatch):
    client = _client_with_stub(monkeypatch)
    r = client.post("/jobs", files={"file": ("song.wav", io.BytesIO(b"data"), "audio/wav")})
    assert r.status_code == 201
    job_id = r.json()["jobId"]
    status = None
    for _ in range(50):
        body = client.get(f"/jobs/{job_id}").json()
        status = body["status"]
        if status in ("done", "error"):
            break
        time.sleep(0.02)
    assert status == "done"
    names = {s["name"] for s in client.get(f"/jobs/{job_id}").json()["stems"]}
    assert names == {"vocals", "drums", "bass", "other"}
    # stem bytes are downloadable
    assert client.get(f"/jobs/{job_id}/stems/vocals").status_code == 200


def test_delete_job(monkeypatch):
    client = _client_with_stub(monkeypatch)
    job_id = client.post(
        "/jobs", files={"file": ("song.wav", io.BytesIO(b"data"), "audio/wav")}
    ).json()["jobId"]
    assert client.delete(f"/jobs/{job_id}").status_code == 200
    assert client.get(f"/jobs/{job_id}").status_code == 404
