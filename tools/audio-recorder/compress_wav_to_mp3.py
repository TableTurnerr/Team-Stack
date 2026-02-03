import os
import sys
from pydub import AudioSegment

def compress_wav_to_mp3(target_directory):
    """
    Converts all WAV files in the given directory to MP3.
    Applies aggressive compression (Mono, Low Sample Rate, Low Bitrate).
    """
    
    # 1. Verify directory exists
    if not os.path.exists(target_directory):
        print(f"\n[!] Error: The directory '{target_directory}' does not exist.")
        return

    # 2. Gather all WAV files
    wav_files = [f for f in os.listdir(target_directory) if f.lower().endswith(".wav")]
    
    if not wav_files:
        print(f"\n[!] No .wav files found in: {target_directory}")
        return

    print(f"\n--- Found {len(wav_files)} files. Starting Maximum Compression ---")

    for filename in wav_files:
        # Construct full paths
        wav_path = os.path.join(target_directory, filename)
        
        # Keep original name, just change extension
        base_name = os.path.splitext(filename)[0]
        mp3_filename = f"{base_name}.mp3"
        mp3_path = os.path.join(target_directory, mp3_filename)

        try:
            print(f"Processing: {filename}...")
            
            # Load audio
            audio = AudioSegment.from_wav(wav_path)

            # --- MAXIMUM COMPRESSION LOGIC ---
            # 1. Convert to Mono (1 channel) - Cuts data roughly in half if originally stereo
            audio = audio.set_channels(1)
            
            # 2. Reduce Sample Rate to 22050Hz - acceptable for speech, saves space
            audio = audio.set_frame_rate(22050)

            # 3. Export as MP3 with 32k bitrate and lowest quality score (9)
            audio.export(
                mp3_path, 
                format="mp3", 
                bitrate="32k", 
                parameters=["-q:a", "9"] 
            )
            
            print(f" -> Success: {mp3_filename}")

        except Exception as e:
            print(f" -> [!] ERROR on {filename}: {e}")

    print("\n--- Processing Complete ---")

if __name__ == "__main__":
    # Ask user for input
    user_path = input("Enter the full path to the directory containing your WAV files: ")
    
    # Remove quotes if the user pasted them (common when copying paths)
    clean_path = user_path.strip('"').strip("'")
    
    compress_wav_to_mp3(clean_path)