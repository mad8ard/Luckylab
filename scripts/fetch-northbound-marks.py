#!/usr/bin/env python3
"""兼容入口：北向标记已改为读取客户端导出名单。

真正的实现见 build-northbound-marks.py。
"""

from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).with_name("build-northbound-marks.py")), run_name="__main__")
