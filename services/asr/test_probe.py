"""Kiểm tra giới hạn và phát hiện nội dung giả trước khi công bố video."""

import pytest
from make_test_video import create_video
from probe import probe


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    path = tmp_path_factory.mktemp("media") / "valid.mp4"
    create_video(path)
    return path


def test_valid_video_is_fully_decoded(video):
    result = probe(video, 1024 * 1024, 60)
    assert result["decoded_frames"]["video"] == 48
    assert result["decoded_frames"]["audio"] > 90
    assert 2 <= result["duration_sec"] < 3


def test_size_limit(video):
    with pytest.raises(ValueError, match="INVALID_SIZE"):
        probe(video, video.stat().st_size - 1, 60)


def test_duration_limit(video):
    with pytest.raises(ValueError, match="INVALID_DURATION"):
        probe(video, 1024 * 1024, 1)


def test_fake_mp4_is_rejected(tmp_path):
    path = tmp_path / "fake.mp4"
    path.write_bytes(b"not a video file")
    with pytest.raises(ValueError, match="INVALID_CONTAINER"):
        probe(path, 1024, 60)


def test_empty_file_is_rejected(tmp_path):
    path = tmp_path / "empty.mp4"
    path.touch()
    with pytest.raises(ValueError, match="INVALID_SIZE"):
        probe(path, 1024, 60)
