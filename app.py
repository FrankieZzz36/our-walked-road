# -*- coding: utf-8 -*-
"""
我们一起走过的路 · 黄道十二宫
=====================

PyCharm + Anaconda 启动入口。

运行环境：
    D:\\anaconda\\python.exe   (Anaconda, Python 3.14)
    PySide6 6.11.0 + QtWebEngine

项目结构：
    app.py                  Python 全屏宿主窗口
    web/index.html          页面结构
    web/style.css           视觉、动画、虚化、弹窗样式
    web/app.js              开场结束、人物档案数据与交互
    web/assets/             视频、时钟图片、图标、噪点
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# QtWebEngine 必须在创建 QApplication 之前设置 Chromium 参数。
# 这里采用“追加”而不是覆盖，避免环境中已有其他 flags 时丢失配置。
_CHROMIUM_FLAGS = [
    # 该机器上 QtWebEngine 的多进程渲染器无法建立共享 GL 上下文；
    # 单进程模式可以正常加载页面与本地视频。
    "--single-process",
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--allow-file-access-from-files",
    "--disable-features=CalculateNativeWinOcclusion",
]
_flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
for _flag in _CHROMIUM_FLAGS:
    if _flag not in _flags.split():
        _flags = f"{_flags} {_flag}".strip()
os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = _flags

from PySide6.QtCore import (  # noqa: E402
    QEvent,
    QTimer,
    QUrl,
    QUrlQuery,
    Qt,
)
from PySide6.QtGui import (  # noqa: E402
    QColor,
    QGuiApplication,
    QIcon,
    QKeySequence,
    QShortcut,
)
from PySide6.QtWidgets import QApplication, QMainWindow  # noqa: E402
from PySide6.QtWebEngineCore import (  # noqa: E402
    QWebEnginePage,
    QWebEngineSettings,
)
from PySide6.QtWebEngineWidgets import QWebEngineView  # noqa: E402


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
INDEX_FILE = WEB_DIR / "index.html"
ASSETS_DIR = WEB_DIR / "assets"


class ConsolePage(QWebEnginePage):
    """把网页 console 输出转发到 PyCharm 的运行窗口，便于调试。"""

    def javaScriptConsoleMessage(self, level, message, line_number, source_id):
        source = Path(source_id).name if source_id else "web"
        try:
            level_name = level.name
        except AttributeError:
            level_name = str(level)
        print(f"[web:{level_name}] {message}  ({source}:{line_number})", flush=True)


class StarSeaWindow(QMainWindow):
    def __init__(self, args: argparse.Namespace) -> None:
        super().__init__()
        self.args = args
        self._cursor_hidden = False
        self._capture_path = Path(args.screenshot).expanduser() if args.screenshot else None

        self.setWindowTitle("我们一起走过的路 · 黄道十二宫")
        icon_path = ASSETS_DIR / "icon.png"
        if icon_path.exists():
            self.setWindowIcon(QIcon(str(icon_path)))

        if args.windowed:
            self.setWindowFlags(Qt.WindowType.Window)
            self.resize(1280, 800)
            self.setMinimumSize(900, 560)
        else:
            self.setWindowFlags(
                Qt.WindowType.Window
                | Qt.WindowType.FramelessWindowHint
            )

        self.view = QWebEngineView(self)
        self.page = ConsolePage(self.view)
        self.view.setPage(self.page)
        self.page.setBackgroundColor(QColor("#030512"))

        settings = self.view.settings()
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, False
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.JavascriptEnabled, True
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.PlaybackRequiresUserGesture, False
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.FullScreenSupportEnabled, True
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.WebGLEnabled, True
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.Accelerated2dCanvasEnabled, True
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.ShowScrollBars, False
        )

        self.view.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        self.view.setStyleSheet("background: #030512;")
        self.setCentralWidget(self.view)

        self._bind_shortcuts()
        self._bind_cursor_autohide()
        self._load_page()
        self._bind_lifecycle()

    # ------------------------------------------------------------------
    # 页面
    # ------------------------------------------------------------------
    def _load_page(self) -> None:
        url = QUrl.fromLocalFile(str(INDEX_FILE))
        query = QUrlQuery()
        if self.args.preview:
            query.addQueryItem("preview", "1")
        if self.args.intro_test:
            query.addQueryItem("introTest", "1")
        if self.args.modal:
            query.addQueryItem("modal", self.args.modal)
        if self.args.spots:
            query.addQueryItem("spots", "1")
        if not query.isEmpty():
            url.setQuery(query)

        self.page.loadFinished.connect(self._on_load_finished)
        self.view.load(url)

    def _on_load_finished(self, ok: bool) -> None:
        print(f"[app] web load finished: {ok}", flush=True)
        if not ok:
            print("[app] 页面加载失败，请检查 web/index.html 与资源路径。", flush=True)

    # ------------------------------------------------------------------
    # 快捷键
    # ------------------------------------------------------------------
    def _bind_shortcuts(self) -> None:
        QShortcut(QKeySequence("Ctrl+Q"), self, activated=self.close)
        QShortcut(QKeySequence("F5"), self, activated=self.view.reload)
        QShortcut(QKeySequence("F11"), self, activated=self._toggle_fullscreen)

    def _toggle_fullscreen(self) -> None:
        if self.isFullScreen():
            self.showNormal()
            self.resize(1280, 800)
            self._show_cursor()
        else:
            self.showFullScreen()

    # ------------------------------------------------------------------
    # 鼠标静止后隐藏指针，更像壁纸
    # ------------------------------------------------------------------
    def _bind_cursor_autohide(self) -> None:
        if self.args.windowed or self.args.no_cursor_hide:
            return

        self._cursor_timer = QTimer(self)
        self._cursor_timer.setInterval(2600)
        self._cursor_timer.setSingleShot(True)
        self._cursor_timer.timeout.connect(self._hide_cursor)
        QApplication.instance().installEventFilter(self)

    def eventFilter(self, watched, event):
        if event.type() == QEvent.Type.MouseMove:
            self._show_cursor()
            timer = getattr(self, "_cursor_timer", None)
            if timer is not None:
                timer.start()
        return super().eventFilter(watched, event)

    def _hide_cursor(self) -> None:
        if not self._cursor_hidden:
            QGuiApplication.setOverrideCursor(Qt.CursorShape.BlankCursor)
            self._cursor_hidden = True

    def _show_cursor(self) -> None:
        if self._cursor_hidden:
            QGuiApplication.restoreOverrideCursor()
            self._cursor_hidden = False

    # ------------------------------------------------------------------
    # 生命周期 / 调试截图
    # ------------------------------------------------------------------
    def _bind_lifecycle(self) -> None:
        if self.args.exit_after > 0:
            delay_ms = int(self.args.exit_after * 1000)
            if self._capture_path is not None:
                QTimer.singleShot(delay_ms, self._capture_and_quit)
            else:
                QTimer.singleShot(delay_ms, QApplication.instance().quit)

    def _capture_and_quit(self) -> None:
        if self._capture_path is None:
            QApplication.instance().quit()
            return

        self._capture_path.parent.mkdir(parents=True, exist_ok=True)
        pixmap = self.view.grab()
        ok = pixmap.save(str(self._capture_path))
        print(
            f"[app] screenshot {'saved' if ok else 'failed'}: {self._capture_path}",
            flush=True,
        )
        QApplication.instance().quit()

    def closeEvent(self, event):
        self._show_cursor()
        super().closeEvent(event)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="我们一起走过的路 · 黄道十二宫")
    parser.add_argument(
        "--windowed",
        action="store_true",
        help="以 1280x800 窗口运行，便于开发调试（默认全屏）",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="跳过开场，直接显示完整主画面（调试用）",
    )
    parser.add_argument(
        "--intro-test",
        action="store_true",
        help="把开场视频定位到结尾前 1.4 秒，便于测试过渡",
    )
    parser.add_argument(
        "--modal",
        choices=("pisces", "leo"),
        help="预览时自动打开指定人物档案",
    )
    parser.add_argument(
        "--spots",
        action="store_true",
        help="调试时显示两个星座热点的位置和标签",
    )
    parser.add_argument(
        "--screenshot",
        metavar="PATH",
        help="在 --exit-after 后截图并退出（调试用）",
    )
    parser.add_argument(
        "--exit-after",
        type=float,
        default=0,
        metavar="SECONDS",
        help="指定秒数后退出（0 表示不自动退出）",
    )
    parser.add_argument(
        "--no-cursor-hide",
        action="store_true",
        help="不自动隐藏鼠标指针",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()

    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    app = QApplication(sys.argv)
    app.setApplicationName("我们一起走过的路")
    app.setApplicationDisplayName("我们一起走过的路 · 黄道十二宫")
    app.setOrganizationName("StarSea")
    app.setStyle("Fusion")
    app.setFont(app.font())

    window = StarSeaWindow(args)
    if args.windowed:
        window.show()
        # 窗口模式居中，方便在 PyCharm 中调试。
        screen = app.primaryScreen()
        if screen is not None:
            geo = window.frameGeometry()
            geo.moveCenter(screen.availableGeometry().center())
            window.move(geo.topLeft())
    else:
        window.showFullScreen()

    window.view.setFocus(Qt.FocusReason.OtherFocusReason)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
