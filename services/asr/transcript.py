"""Kiểm tra phụ đề và timestamp trước khi tạo phiên bản transcript."""

from dataclasses import asdict, dataclass
import math
import re


@dataclass(frozen=True)
class Segment:
    start_sec: float
    end_sec: float
    text: str


def validate_segments(segments: list[Segment], duration: float) -> list[Segment]:
    """Giữ nguyên thời gian nguồn; từ chối dữ liệu hỏng thay vì tự sửa."""
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Thời lượng phải hữu hạn và lớn hơn 0.")
    if not segments:
        raise ValueError("Transcript không được rỗng.")
    previous_start = -1.0
    for segment in segments:
        if not (math.isfinite(segment.start_sec) and math.isfinite(segment.end_sec)):
            raise ValueError("Timestamp phải hữu hạn.")
        if not 0 <= segment.start_sec < segment.end_sec <= duration:
            raise ValueError("Timestamp nằm ngoài thời lượng hoặc khoảng rỗng.")
        if segment.start_sec < previous_start:
            raise ValueError("Các đoạn phải theo thứ tự thời gian.")
        if not segment.text.strip():
            raise ValueError("Đoạn transcript không có nội dung.")
        previous_start = segment.start_sec
    return segments


def parse_timestamp(value: str) -> float:
    """Đọc timestamp SRT hoặc VTT, không làm tròn thời gian."""
    match = re.fullmatch(r"(?:(\d{2,}):)?(\d{2}):(\d{2})[,.](\d{3})", value)
    if not match:
        raise ValueError("Định dạng timestamp không hợp lệ.")
    hours, minutes, seconds, milliseconds = match.groups()
    if int(minutes) >= 60 or int(seconds) >= 60:
        raise ValueError("Phút và giây phải nhỏ hơn 60.")
    return int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds) + int(milliseconds) / 1000


def parse_subtitles(content: str, duration: float) -> list[Segment]:
    """Đọc cue SRT/VTT cơ bản, không thực thi markup hoặc nội dung phụ đề."""
    content = content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").strip()
    segments = []
    for block in re.split(r"\n\s*\n", content):
        lines = block.splitlines()
        if not lines:
            continue
        if lines[0].startswith(("WEBVTT", "NOTE", "STYLE", "REGION")):
            continue
        timing_index = 0 if "-->" in lines[0] else 1
        if len(lines) <= timing_index + 1 or "-->" not in lines[timing_index]:
            raise ValueError("Cue phụ đề không hợp lệ.")
        start, end = lines[timing_index].split("-->", 1)
        segments.append(Segment(parse_timestamp(start.strip()), parse_timestamp(end.strip().split()[0]),
                                "\n".join(lines[timing_index + 1:])))
    return validate_segments(segments, duration)


def serialize_segments(segments: list[Segment]) -> list[dict]:
    return [asdict(segment) for segment in segments]
