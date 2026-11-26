# PyInstaller recipe for FenceBuilder.exe (run from the repository root):
#   python -m PyInstaller installer/fence-builder.spec
# Makes dist/FenceBuilder/ (FenceBuilder.exe plus its _internal folder), which
# installer/fence-builder.iss wraps into FenceBuilder-Setup-<version>.exe.
import os

ROOT = os.path.dirname(SPECPATH)  # SPECPATH is this file's folder, installer/

a = Analysis(
    [os.path.join(ROOT, "app.py")],
    pathex=[ROOT],
    datas=[
        (os.path.join(ROOT, "static"), "static"),
        (os.path.join(ROOT, "VERSION"), "."),
        (os.path.join(ROOT, "update.json"), "."),
        (os.path.join(ROOT, "fence.ico"), "."),
    ],
    hiddenimports=["server", "offline"],
    excludes=["tkinter", "unittest", "pydoc", "test"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="FenceBuilder",
    icon=os.path.join(ROOT, "fence.ico"),
    console=False,  # no black console window
    upx=False,      # UPX-packed exes get flagged by antivirus more often
)
coll = COLLECT(exe, a.binaries, a.datas, name="FenceBuilder", upx=False)
