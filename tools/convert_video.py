# -*- coding: utf-8 -*-
"""
把普通视频转换为 QtWebEngine 可播放的 VP9 WebM。

用法：
    D:\\anaconda\\python.exe tools\\convert_video.py "输入视频.mp4"
    D:\\anaconda\\python.exe tools\\convert_video.py "输入视频.mp4" -o "输出.webm"

依赖：
    D:\\anaconda\\python.exe -m pip install imageio-ffmpeg
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def find_ffmpeg() -> str:
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass

    exe = shutil.which("ffmpeg")
    if exe:
        return exe

    raise SystemExit(
        "未找到 ffmpeg。\n"
        "请先运行：D:\\anaconda\\python.exe -m pip install imageio-ffmpeg\n"
        "或把 ffmpeg.exe 加入 PATH。"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="将视频转换为 VP9 WebM（QtWebEngine 兼容格式）"
    )
    parser.add_argument("input", help="输入视频路径，例如 new_video.mp4")
    parser.add_argument(
        "-o",
        "--output",
        help="输出路径；默认与输入同目录，扩展名为 .webm",
    )
    parser.add_argument(
        "--crf",
        type=int,
        default=33,
        help="画质参数，越小越清晰、文件越大（默认 33）",
    )
    parser.add_argument(
        "--cpu-used",
        type=int,
        default=2,
        help="编码速度 0-5，越大越快、压缩率略低（默认 2）",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=8,
        help="编码线程数（默认 8）",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()

    src = Path(args.input).expanduser().resolve()
    if not src.is_file():
        raise SystemExit(f"输入文件不存在：{src}")

    dst = (
        Path(args.output).expanduser().resolve()
        if args.output
        else src.with_suffix(".webm")
    )
    dst.parent.mkdir(parents=True, exist_ok=True)

    ffmpeg = find_ffmpeg()
    command = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-i",
        str(src),
        "-an",
        "-c:v",
        "libvpx-vp9",
        "-b:v",
        "0",
        "-crf",
        str(args.crf),
        "-row-mt",
        "1",
        "-threads",
        str(args.threads),
        "-deadline",
        "good",
        "-cpu-used",
        str(args.cpu_used),
        "-pix_fmt",
        "yuv420p",
        str(dst),
    ]

    print(f"ffmpeg : {ffmpeg}")
    print(f"输入   : {src}")
    print(f"输出   : {dst}")
    print("编码中，请稍候……", flush=True)

    result = subprocess.run(command)
    if result.returncode != 0:
        print(f"\n转换失败，ffmpeg 返回码：{result.returncode}", file=sys.stderr)
        return result.returncode

    size_mb = dst.stat().st_size / (1024 * 1024) if dst.exists() else 0
    print(f"\n完成：{dst}  ({size_mb:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
