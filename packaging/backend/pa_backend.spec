# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec: bundles the compiled app.pyd + dependencies into dist/pa-backend/ (one folder).
# Run from the staging folder that contains app.pyd, pa_backend.py and bundle_imports.py
# (packaging/build.ps1 does this).
import glob

from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata

datas, binaries, hiddenimports = [], [], []

# The application itself: the Nuitka-compiled extension module (e.g. app.cp312-win_amd64.pyd).
# PyInstaller cannot see inside it, so `from app.entry import ...` does not make it bundle the file;
# add it explicitly, at the bundle root where the frozen interpreter imports from.
_app_pyd = glob.glob("app.*.pyd") + glob.glob("app.pyd")
if not _app_pyd:
    raise SystemExit("[spec] compiled app*.pyd not found next to the spec - run the Nuitka step first")
binaries.append((_app_pyd[0], "."))
print(f"[spec] bundling compiled app module: {_app_pyd[0]}")


def add_all(pkg):
    try:
        d, b, h = collect_all(pkg)
        datas.extend(d)
        binaries.extend(b)
        hiddenimports.extend(h)
    except Exception as exc:  # optional packages may be absent
        print(f"[spec] skipped {pkg}: {exc}")


def add_submodules(pkg):
    try:
        hiddenimports.extend(collect_submodules(pkg))
    except Exception as exc:
        print(f"[spec] skipped submodules of {pkg}: {exc}")


def add_metadata(dist):
    try:
        datas.extend(copy_metadata(dist))
    except Exception as exc:
        print(f"[spec] no metadata for {dist}: {exc}")


# Web service + data
for pkg in ["uvicorn", "fastapi", "starlette", "pydantic", "pydantic_settings", "yfinance", "curl_cffi", "certifi", "tzdata", "pytz", "truststore", "cryptography"]:
    add_all(pkg)
add_submodules("pandas_ta")

# Local ML (only when installed in the build environment)
for pkg in ["chronos", "huggingface_hub", "safetensors", "tokenizers"]:
    add_all(pkg)
for pkg in ["transformers.models.auto", "transformers.models.bert", "transformers.models.t5", "transformers.pipelines"]:
    add_submodules(pkg)
# transformers checks dependency versions via package metadata at import time
for dist in ["transformers", "tokenizers", "huggingface-hub", "safetensors", "torch", "tqdm", "regex", "requests", "packaging", "filelock", "numpy", "pyyaml", "fsspec"]:
    add_metadata(dist)

a = Analysis(
    ["pa_backend.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "IPython", "jupyter", "notebook", "pytest", "tensorflow", "jax", "flax", "keras"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="pa-backend",
    icon="icon.ico",
    console=True,  # visible only for the model-download window; the desktop app starts it hidden
    upx=False,
    debug=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="pa-backend")
