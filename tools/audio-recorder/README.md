# Audio Recorder

A simple, Python-based audio recorder with a graphical user interface (GUI) built using Tkinter. This application allows users to record audio from their microphone, desktop audio (system sound), or both simultaneously. It features configurable hotkeys, real-time audio level visualization, and flexible saving options.

## Features

*   **Flexible Recording Sources:** Record from your default microphone, desktop audio (requires "Stereo Mix" or similar loopback device), or a combination of both.
*   **Intuitive GUI:** Easy-to-use interface powered by Tkinter.
*   **Global Hotkey Control:** Start and stop recordings using a configurable global keyboard shortcut.
*   **Real-time Audio Levels:** Visualize microphone and desktop audio input levels during recording via a discreet overlay.
*   **Troubleshooting Guide:** Includes an in-app guide to help set up desktop audio recording (e.g., enabling Stereo Mix on Windows).
*   **Configurable Save Options:** Choose to be prompted for a save location after each recording or automatically save to a predefined directory.
*   **WAV Output:** Recordings are saved as high-quality WAV audio files.
*   **Device Selection:** Advanced settings allow manual selection of audio input devices.

## Installation

This recorder requires Python 3.x.

1.  **Navigate to the `AudioRecorder` directory:**
    ```bash
    cd AudioRecorder
    ```

2.  **Install dependencies:**
    It's recommended to use a virtual environment.
    ```bash
    python -m venv venv
    .\venv\Scripts\activate   # On Windows
    source venv/bin/activate # On macOS/Linux
    pip install -r requirements.txt
    ```
    The required packages are:
    *   `sounddevice`: For audio input/output.
    *   `soundcard`: (Optional, but recommended) Provides additional audio device control.
    *   `numpy`: For numerical operations on audio data.
    *   `scipy`: For saving WAV files.
    *   `keyboard`: For global hotkey functionality.

    **Note:** If you encounter issues with `sounddevice`, ensure you have the necessary system audio drivers installed. For Windows, you might need to install Visual C++ Redistributable.

## Usage

1.  **Run the application:**
    ```bash
    python recorder.py
    ```

2.  **Main Window:**
    *   **Recording Source:** Select whether you want to record "Microphone Only", "Desktop Audio Only", or "Both (Mic + Desktop)".
    *   **Start/Stop Recording Button:** Click to begin or end a recording session.
    *   **Status Label:** Shows the current state of the application (e.g., "Ready", "Recording...", "Saved").
    *   **Hotkey Display:** Shows the currently configured global hotkey. Click "Change" to set a new one.
    *   **Troubleshooting Link:** If desktop audio isn't working, click this link for guidance on enabling "Stereo Mix" or similar loopback devices.

3.  **Advanced Settings:**
    Click "Show Advanced Settings" to reveal:
    *   **Device Selection:** Manually choose specific microphone and desktop audio input devices. Click "Refresh Devices" if new devices are connected.
    *   **Save Location:**
        *   **"Ask every time"**: You will be prompted to choose a save location and filename after each recording.
        *   **"Auto-save to folder"**: Recordings will automatically be saved with a timestamped filename (e.g., `recording_DDMMYYYY_HHMMSS.wav`) to the specified folder. Use "Browse..." to change the auto-save directory.

4.  **Recording Overlay:**
    When recording, a small, always-on-top overlay will appear in the top-right corner of your screen, showing:
    *   A blinking red dot and "REC" indicator.
    *   Elapsed recording time.
    *   Real-time audio level bars for Microphone (MIC) and System (SYS) audio.

## Hotkeys

The default hotkey is `Ctrl+Shift+R`. You can change this via the "Change" button next to the Hotkey display. The hotkey will work globally, even if the recorder application is in the background.

## Configuration

The application stores its configuration (hotkey, save mode, save directory) in `config.json` located in the `AudioRecorder` directory. You can edit this file manually, but it's generally recommended to use the in-app settings.

## Troubleshooting Desktop Audio

For recording desktop audio, Windows typically requires enabling a "Stereo Mix" or equivalent loopback device in your sound settings. The in-app "Desktop audio not working? Click here" button provides detailed instructions and quick links to relevant Windows settings. If "Stereo Mix" is not available, your sound card might not support it, or you may need updated audio drivers. Some users might find "What U Hear" or "Wave Out Mix" as alternatives.