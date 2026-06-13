# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller hook for tiktoken tokenizer.

tiktoken loads its BPE encodings from the ``tiktoken_ext`` package at
runtime, which PyInstaller cannot detect statically.
"""

hiddenimports = [
    "tiktoken_ext",
    "tiktoken_ext.openai_public",
]
