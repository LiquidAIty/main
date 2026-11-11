"""Reproduce the reviewed Kronos package-import compatibility edit inside an image."""
# Entity: Oracle Deployment
# Relationship: Applies only the existing Kronos relative-import patch to copied source, accepting the reviewed upstream or already-patched header and rejecting other inputs.
from __future__ import annotations

import argparse
from pathlib import Path

UPSTREAM = '''import numpy as np
import pandas as pd
import torch
from huggingface_hub import PyTorchModelHubMixin
import sys

from tqdm import trange

sys.path.append("../")
from model.module import *
'''
PATCHED = UPSTREAM.replace('import sys\n', '').replace(
    'sys.path.append("../")\nfrom model.module import *\n', 'from .module import *\n')


def patch_import(source: str) -> str:
    if source.startswith(PATCHED):
        return source
    if not source.startswith(UPSTREAM):
        raise ValueError('Unexpected Kronos import header; no patch applied')
    return PATCHED + source[len(UPSTREAM):]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('copied_source', type=Path)
    path = parser.parse_args().copied_source
    original = path.read_text(encoding='utf-8')
    updated = patch_import(original)
    if updated != original:
        path.write_text(updated, encoding='utf-8', newline='\n')
    print('Kronos relative-import compatibility verified; model math unchanged')
