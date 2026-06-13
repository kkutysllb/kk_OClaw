# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller hook for Google GenAI (google.genai).

The google-genai package uses a dotted namespace that PyInstaller may not
collect properly by default.
"""

from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules("google.genai")
