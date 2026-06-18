"""Module entry point: ``python -m kkoclaw`` → oclaw-code CLI."""

import sys

from kkoclaw.coding_cli import main

if __name__ == "__main__":
    sys.exit(main())
