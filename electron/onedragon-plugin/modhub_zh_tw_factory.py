# ModHub：讓 OneDragon 支援繁體中文遊戲畫面
#
# OneDragon 用文字辨識（OCR）比對畫面上的簡體字（例如「训练」）。遊戲文字設成繁體中文時會對不上。
# 這個外掛在 OneDragon 載入外掛時，把 OCR 模型輸出的文字先轉成簡體（繁→簡對照表 t2s.json，
# 由 ModHub 用 OpenCC 字典產生，Apache-2.0），OneDragon 其他部分完全不變。
#
# 由 ModHub 安裝到 <OneDragon>/plugins/modhub_zh_tw/（plugins 不受 OneDragon 的程式更新影響）。
# 移除：刪掉這個資料夾，或在 ModHub「自動每日」按「移除」。重新啟動 OneDragon 後生效。
from __future__ import annotations

import json
import os

from one_dragon.base.operation.application.application_factory import ApplicationFactory

from . import modhub_zh_tw_const

_MAP_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 't2s.json')


def _load_map() -> dict:
    try:
        with open(_MAP_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


_T2S = _load_map()


def to_simplified(text: str) -> str:
    """逐字把繁體轉成簡體（對照表裡沒有的字原樣保留）"""
    if not _T2S or not text:
        return text
    return ''.join(_T2S.get(ch, ch) for ch in text)


def _convert(value):
    """OCR 結果是巢狀的 list / tuple（位置、(文字, 分數)），把裡面的字串都轉成簡體，其他資料原樣保留"""
    if isinstance(value, str):
        return to_simplified(value)
    if isinstance(value, list):
        return [_convert(v) for v in value]
    if isinstance(value, tuple):
        return tuple(_convert(v) for v in value)
    return value


def _install_patch() -> bool:
    try:
        from onnxocr.onnx_paddleocr import ONNXPaddleOcr
    except Exception:
        return False
    if getattr(ONNXPaddleOcr, '_modhub_zh_tw', False):
        return True
    original = ONNXPaddleOcr.ocr

    def ocr(self, *args, **kwargs):
        return _convert(original(self, *args, **kwargs))

    ONNXPaddleOcr.ocr = ocr
    ONNXPaddleOcr._modhub_zh_tw = True
    return True


PATCHED = _install_patch()


class ModhubZhTwFactory(ApplicationFactory):
    """沒有可執行的內容；存在只是為了讓 OneDragon 載入這個外掛"""

    def __init__(self, ctx):
        ApplicationFactory.__init__(self, modhub_zh_tw_const)
        self.ctx = ctx
