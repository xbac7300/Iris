"""CLI ASR dùng file và model cục bộ; không tự tải URL hoặc model từ mạng."""

import argparse
import json
from pathlib import Path

from transcript import Segment, serialize_segments, validate_segments


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--language", choices=["auto", "vi", "en"], default="auto")
    args = parser.parse_args()
    if not args.input.is_file() or args.input.stat().st_size > 500 * 1024 * 1024:
        parser.error("File không tồn tại hoặc vượt quá 500 MB.")
    if not args.model.is_dir():
        parser.error("Cần thư mục faster-whisper model đã chuẩn bị cục bộ.")
    import av
    from faster_whisper import WhisperModel

    with av.open(str(args.input)) as container:
        if not container.duration or container.duration / av.time_base > 3600:
            parser.error("Thời lượng không hợp lệ hoặc vượt quá 60 phút.")
    model = WhisperModel(str(args.model.resolve()), device="cpu", compute_type="int8", cpu_threads=2,
                         num_workers=1, local_files_only=True)
    raw, info = model.transcribe(str(args.input.resolve()), language=None if args.language == "auto" else args.language, beam_size=5, vad_filter=True)
    segments = validate_segments([Segment(segment.start, segment.end, segment.text.strip()) for segment in raw], info.duration)
    args.output.write_text(json.dumps({"language": info.language, "duration": info.duration,
                                      "segments": serialize_segments(segments)}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
