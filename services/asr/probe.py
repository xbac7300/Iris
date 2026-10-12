"""Kiểm tra MP4 và giải mã frame bằng FFmpeg qua PyAV, không nhận URL."""

import argparse
import json
import math
from pathlib import Path


def probe(path: Path, max_bytes: int, max_duration: float) -> dict:
    import av
    if not path.is_file() or not 0 < path.stat().st_size <= max_bytes:
        raise ValueError("INVALID_SIZE")
    with path.open("rb") as source:
        header = source.read(12)
    if len(header) < 12 or header[4:8] != b"ftyp":
        raise ValueError("INVALID_CONTAINER")
    with av.open(str(path), options={"err_detect": "explode"}) as container:
        videos, audios = list(container.streams.video), list(container.streams.audio)
        if len(videos) != 1 or len(audios) != 1 or len(container.streams) != 2:
            raise ValueError("INVALID_STREAMS")
        video, audio = videos[0], audios[0]
        if video.codec_context.name != "h264" or audio.codec_context.name != "aac":
            raise ValueError("INVALID_CODEC")
        duration = container.duration / av.time_base if container.duration else 0
        if not math.isfinite(duration) or not 0 < duration <= max_duration:
            raise ValueError("INVALID_DURATION")
        if not (0 < video.width <= 1920 and 0 < video.height <= 1080):
            raise ValueError("INVALID_RESOLUTION")
        video.codec_context.thread_count = 2
        audio.codec_context.thread_count = 1
        frames = {"video": 0, "audio": 0}
        for packet in container.demux(video, audio):
            for frame in packet.decode():
                if getattr(frame, "is_corrupt", False):
                    raise ValueError("CORRUPT_MEDIA")
                frames[packet.stream.type] += 1
        if not frames["video"] or not frames["audio"]:
            raise ValueError("EMPTY_MEDIA")
        return {"ok": True, "duration_sec": duration, "bytes": path.stat().st_size,
                "video_codec": "h264", "audio_codec": "aac", "decoded_frames": frames}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--max-bytes", type=int, required=True)
    parser.add_argument("--max-duration", type=float, required=True)
    args = parser.parse_args()
    try:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024**2, 1536 * 1024**2))
            resource.setrlimit(resource.RLIMIT_CPU, (240, 240))
        except ImportError:
            pass
        result = probe(args.input.resolve(), args.max_bytes, args.max_duration)
    except ValueError as error:
        result = {"ok": False, "code": str(error)}
    except Exception:
        result = {"ok": False, "code": "CORRUPT_MEDIA"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
