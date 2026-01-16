# -*- mode: python ; coding: utf-8 -*-
import os
import sounddevice
import scipy

# Get paths for bundled dependencies
sounddevice_path = os.path.dirname(sounddevice.__file__)
scipy_path = os.path.dirname(scipy.__file__)

# Find PortAudio DLLs in sounddevice package
binaries_list = []
for f in os.listdir(sounddevice_path):
    if f.endswith('.dll') or f.endswith('.so') or f.endswith('.dylib'):
        binaries_list.append((os.path.join(sounddevice_path, f), '.'))

# Include _portaudio module if it exists as a separate file
if os.path.exists(os.path.join(sounddevice_path, '_sounddevice_data')):
    for root, dirs, files in os.walk(os.path.join(sounddevice_path, '_sounddevice_data')):
        for f in files:
            if f.endswith('.dll') or f.endswith('.so') or f.endswith('.dylib'):
                binaries_list.append((os.path.join(root, f), '_sounddevice_data'))

a = Analysis(
    ['recorder.py'],
    pathex=[],
    binaries=binaries_list,
    datas=[
        ('calling_beep.wav', '.'),
        ('config.json', '.') if os.path.exists('config.json') else (None, None),
    ],
    hiddenimports=[
        'sounddevice',
        'soundcard',
        'numpy',
        'scipy',
        'scipy.signal',
        'scipy.io',
        'scipy.io.wavfile',
        'keyboard',
        'keyboard._winkeyboard',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

# Filter out None entries from datas
a.datas = [d for d in a.datas if d[0] is not None]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='AudioRecorder',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
