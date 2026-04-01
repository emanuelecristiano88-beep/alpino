"""
NEUMA raw-scans processor (worker).

Responsibilities:
- Poll Supabase `scans` table for rows with status='pending' and a `video_url` filename.
- Download the video from Storage bucket `raw-scans`.
- Extract frames to `temp/<scan_id>/frames/frame_000001.jpg` (etc).

This repo is primarily frontend; this file is provided to align the expected backend contract.
"""

from __future__ import annotations

import os
import time
import pathlib
import tempfile
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_service_role_key: str
    bucket: str = "raw-scans"
    poll_seconds: float = 2.0
    out_root: str = "temp"
    frame_every_n: int = 1
    max_frames: int | None = None


def _require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Missing env var: {name}")
    return v


def _mkdir(p: pathlib.Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _extract_frames_ffmpeg(src_video: pathlib.Path, dst_dir: pathlib.Path) -> None:
    """
    Uses ffmpeg if available. Output: frame_000001.jpg ...
    """
    import subprocess

    _mkdir(dst_dir)
    out = str(dst_dir / "frame_%06d.jpg")
    cmd = ["ffmpeg", "-y", "-i", str(src_video), "-q:v", "3", out]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _download_storage_file(supabase, bucket: str, path: str, dst: pathlib.Path) -> None:
    data = supabase.storage.from_(bucket).download(path)
    dst.write_bytes(data)


def main() -> None:
    cfg = Config(
        supabase_url=_require_env("SUPABASE_URL"),
        supabase_service_role_key=_require_env("SUPABASE_SERVICE_ROLE_KEY"),
    )

    try:
        from supabase import create_client  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError("Missing dependency: supabase (pip install supabase)") from e

    supabase = create_client(cfg.supabase_url, cfg.supabase_service_role_key)

    out_root = pathlib.Path(cfg.out_root)
    _mkdir(out_root)

    print("[processor] started. polling scans…")

    while True:
        try:
            res = (
                supabase.table("scans")
                .select("id, video_url, status")
                .eq("status", "pending")
                .not_.is_("video_url", "null")
                .order("id", desc=False)
                .limit(1)
                .execute()
            )
            rows = getattr(res, "data", None) or []
            if not rows:
                time.sleep(cfg.poll_seconds)
                continue

            scan = rows[0]
            scan_id = int(scan["id"])
            video_url = str(scan["video_url"])

            frames_dir = out_root / str(scan_id) / "frames"
            _mkdir(frames_dir)

            print(f"[processor] pending scan {scan_id}: {video_url}")

            with tempfile.TemporaryDirectory() as td:
                local = pathlib.Path(td) / "scan.webm"
                _download_storage_file(supabase, cfg.bucket, video_url, local)
                _extract_frames_ffmpeg(local, frames_dir)

            supabase.table("scans").update({"status": "processing"}).eq("id", scan_id).execute()
            print(f"[processor] extracted frames → {frames_dir}")

        except KeyboardInterrupt:
            raise
        except Exception as e:
            print("[processor] error:", repr(e))
            time.sleep(max(2.0, cfg.poll_seconds))


if __name__ == "__main__":
    main()

