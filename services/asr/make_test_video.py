"""Tạo video đen và âm thanh im lặng cho kiểm thử codec, không dùng làm dữ liệu AI."""

import argparse
from fractions import Fraction
from pathlib import Path
import av
import numpy as np


def create_video(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with av.open(str(path), mode="w") as output:
        video = output.add_stream("libx264", rate=24)
        video.width, video.height, video.pix_fmt = 160, 90, "yuv420p"
        audio = output.add_stream("aac", rate=48000)
        audio.layout = "mono"
        for index in range(48):
            frame = av.VideoFrame.from_ndarray(np.zeros((90, 160, 3), dtype=np.uint8), format="rgb24")
            frame.pts = index
            for packet in video.encode(frame):
                output.mux(packet)
        for packet in video.encode():
            output.mux(packet)
        for index in range(94):
            frame = av.AudioFrame.from_ndarray(np.zeros((1, 1024), dtype=np.float32), format="flt", layout="mono")
            frame.sample_rate, frame.time_base, frame.pts = 48000, Fraction(1, 48000), index * 1024
            for packet in audio.encode(frame):
                output.mux(packet)
        for packet in audio.encode():
            output.mux(packet)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    create_video(parser.parse_args().output)
