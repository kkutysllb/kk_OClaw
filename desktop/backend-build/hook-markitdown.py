# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller hook for markitdown document converter.

markitdown loads format converters dynamically via entry points / plugin
discovery, which PyInstaller cannot trace statically.
"""

from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules("markitdown")
hiddenimports += collect_submodules("markitdown.converters")
