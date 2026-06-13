# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller hook for langchain_openai.

LangChain loads model classes dynamically from string paths in config.yaml
(e.g. ``langchain_openai:ChatOpenAI``). PyInstaller's static analysis may
miss the concrete model classes, so we collect all submodules explicitly.
"""

from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules("langchain_openai")
hiddenimports += collect_submodules("langchain_openai.chat_models")
