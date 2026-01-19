
import sys
import subprocess
import os
import ctypes

def check_python_version():
    print(f"Python Version: {sys.version}")
    if sys.version_info < (3, 6):
        print("❌ Python 3.6+ is required.")
        return False
    return True

def check_import(module_name):
    try:
        __import__(module_name)
        print(f"✅ '{module_name}' imported successfully.")
        return True
    except ImportError as e:
        print(f"❌ Failed to import '{module_name}': {e}")
        return False
    except OSError as e:
        print(f"❌ Failed to verify '{module_name}' (DLL load failed): {e}")
        if "The specified module could not be found" in str(e) and module_name == "sounddevice":
             print("   👉 This often means Visual C++ Redistributable is missing.")
             print("   👉 Please install: https://aka.ms/vs/17/release/vc_redist.x64.exe")
        return False

def check_file_exists(filepath):
    if os.path.exists(filepath):
        print(f"✅ File found: {filepath}")
        return True
    else:
        print(f"❌ File missing: {filepath}")
        return False

def check_audio_devices():
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        print(f"\n✅ Found {len(devices)} audio devices.")
        # Check for loopback
        loopbacks = [d['name'] for d in devices if any(kw in d['name'].lower() for kw in ['stereo mix', 'wave out', 'what u hear'])]
        if loopbacks:
            print(f"✅ Loopback device found: {', '.join(loopbacks)}")
        else:
            print("⚠️ No loopback/Stereo Mix device found (Desktop audio recording might fail).")
        return True
    except Exception as e:
        print(f"❌ Audio device query failed: {e}")
        return False

def main():
    print("=== Audio Recorder Troubleshooter ===\n")
    
    if not check_python_version():
        return

    print("\n--- Checking Dependencies ---")
    dependencies = ['sounddevice', 'soundcard', 'numpy', 'scipy', 'keyboard']
    all_deps_ok = True
    for dep in dependencies:
        if not check_import(dep):
            all_deps_ok = False
    
    if not all_deps_ok:
        print("\n❌ Some dependencies are missing or broken.")
        print("Try running: pip install -r requirements.txt")
        return

    print("\n--- Checking Resources ---")
    resource_path = os.path.join(os.path.dirname(__file__), "calling_beep.wav")
    check_file_exists(resource_path)

    print("\n--- Checking Audio System ---")
    check_audio_devices()

    print("\n=== Troubleshooting Complete ===")
    if all_deps_ok:
        print("\n✅ Setup looks good! If it still fails, check the error logs.")
    else:
        print("\n❌ Please fix the issues above.")

    input("\nPress Enter to exit...")

if __name__ == "__main__":
    main()
