#!/usr/bin/env python3
"""
CRM-Tableturnerr Cold Call Transcriber

Transcribes cold call audio files using Google Gemini AI, extracts structured
analysis data, and saves to PocketBase.

Usage:
    python transcribe_calls.py <audio_file_path> [--phone PHONE]

Examples:
    python transcribe_calls.py recording.mp3
    python transcribe_calls.py call.wav --phone "+1-555-123-4567"
"""

import argparse
import json
import os
import sys
from pathlib import Path

import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Local imports
from pocketbase_service import (
    get_authenticated_client,
    find_or_create_company,
    find_or_create_phone_number,
    create_cold_call_with_transcript,
    create_call_log_with_transcript,
)


# Gemini configuration
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')

# Supported audio formats
SUPPORTED_FORMATS = {'.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm', '.aac'}


TRANSCRIPTION_PROMPT = """
You are an expert cold call analyst. Listen to this cold call recording and provide a detailed analysis.

Extract and return a JSON object with the following structure:
{
    "company_name": "Name of the company being called (extract from conversation)",
    "owner_name": "Name of the decision maker or owner mentioned",
    "receptionist_name": "Name of the receptionist or person who answered (if mentioned, otherwise null)",
    "recipients": "Who answered the call (e.g., 'receptionist', 'owner John', 'manager')",
    "call_outcome": "One of: Interested, Not Interested, Callback, No Answer, Wrong Number, Other",
    "interest_level": 1-10 integer rating of how interested they seemed,
    "objections": ["List of objections raised during the call"],
    "pain_points": ["Pain points or problems mentioned by the prospect"],
    "follow_up_actions": ["Suggested follow-up actions based on the call"],
    "callback_requested": true/false - whether the prospect asked for a callback or said to call back later,
    "callback_notes": "Any specific callback instructions mentioned (e.g., 'call back Tuesday after 2pm')",
    "call_summary": "Brief 2-3 sentence summary of the call",
    "call_duration_estimate": "Estimated duration (e.g., '2 minutes 30 seconds')",
    "transcript": "Full transcript of the conversation with speaker labels"
}

IMPORTANT RULES:
1. Only transcribe the cold call conversation with the recipient
2. Exclude any side conversations in Urdu/Hindi with teammates
3. Use speaker labels like "Caller:" and "Recipient:" in the transcript
4. If the call outcome is unclear, use your best judgment based on the tone
5. Interest level should reflect genuine buying interest, not just politeness
6. Be concise but thorough in the summary
7. Pay special attention to extracting the receptionist's name if they introduce themselves
8. Set callback_requested to true if: they say "call back", "try again later", "he's not in", or similar

Return ONLY the JSON object, no additional text.
"""


def validate_audio_file(file_path: str) -> Path:
    """Validate that the audio file exists and is a supported format."""
    path = Path(file_path)
    
    if not path.exists():
        raise FileNotFoundError(f"Audio file not found: {file_path}")
    
    if path.suffix.lower() not in SUPPORTED_FORMATS:
        raise ValueError(
            f"Unsupported audio format: {path.suffix}. "
            f"Supported formats: {', '.join(SUPPORTED_FORMATS)}"
        )
    
    return path


def transcribe_with_gemini(audio_path: Path) -> dict:
    """
    Transcribe and analyze the audio file using Gemini.
    
    Args:
        audio_path: Path to the audio file
        
    Returns:
        dict: Parsed analysis data from Gemini
    """
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY environment variable is not set")
    
    # Configure Gemini
    genai.configure(api_key=GEMINI_API_KEY)
    
    # Upload the audio file
    print(f"📤 Uploading audio file: {audio_path.name}")
    audio_file = genai.upload_file(path=str(audio_path))
    
    # Create model and generate content
    print(f"🤖 Transcribing with {GEMINI_MODEL}...")
    model = genai.GenerativeModel(GEMINI_MODEL)
    
    response = model.generate_content(
        [TRANSCRIPTION_PROMPT, audio_file],
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
        )
    )
    
    # Parse the JSON response
    try:
        result = json.loads(response.text)
    except json.JSONDecodeError as e:
        print(f"⚠️ Failed to parse JSON response, attempting cleanup...")
        # Try to extract JSON from response
        text = response.text.strip()
        if text.startswith('```json'):
            text = text[7:]
        if text.startswith('```'):
            text = text[3:]
        if text.endswith('```'):
            text = text[:-3]
        result = json.loads(text.strip())
    
    return result


def save_to_pocketbase(analysis: dict, phone_number: str = None, use_legacy: bool = False) -> tuple:
    """
    Save the transcription results to PocketBase.

    Args:
        analysis: Parsed analysis data from Gemini
        phone_number: Optional phone number override
        use_legacy: If True, use old cold_calls workflow (default: False, uses new call_logs)

    Returns:
        tuple: (company, call_log/cold_call, transcript, follow_up) records
    """
    print("💾 Saving to PocketBase...")

    # Get authenticated client
    client = get_authenticated_client()

    try:
        # Find or create company
        company = find_or_create_company(
            client=client,
            company_name=analysis.get('company_name', 'Unknown Company'),
            phone_number=phone_number,
            owner_name=analysis.get('owner_name'),
        )
        print(f"  ✓ Company: {company['company_name']} (ID: {company['id']})")

        # Add phone to analysis for storage
        if phone_number:
            analysis['phone_number'] = phone_number

        if use_legacy:
            # Legacy workflow: create cold_call
            cold_call, transcript = create_cold_call_with_transcript(
                client=client,
                company_id=company['id'],
                transcript_text=analysis.get('transcript', ''),
                analysis=analysis,
                model_used=GEMINI_MODEL,
            )
            print(f"  ✓ Cold Call: {cold_call['id']}")
            print(f"  ✓ Transcript: {transcript['id']}")
            return company, cold_call, transcript, None
        else:
            # NEW workflow: create call_log with phone_number record
            phone_record = find_or_create_phone_number(
                client=client,
                company_id=company['id'],
                phone_number=phone_number or '',
                receptionist_name=analysis.get('receptionist_name'),
            )
            print(f"  ✓ Phone Number: {phone_record.get('phone_number', 'Unknown')} (ID: {phone_record['id']})")

            # Create call log with transcript and potential follow-up
            call_log, transcript, follow_up = create_call_log_with_transcript(
                client=client,
                company_id=company['id'],
                phone_number_record_id=phone_record['id'],
                transcript_text=analysis.get('transcript', ''),
                analysis=analysis,
                model_used=GEMINI_MODEL,
            )
            print(f"  ✓ Call Log: {call_log['id']}")
            print(f"  ✓ Transcript: {transcript['id']}")

            if follow_up:
                print(f"  ✓ Follow-Up Created: {follow_up['id']} (scheduled: {follow_up.get('scheduled_time', 'N/A')})")

            return company, call_log, transcript, follow_up

    finally:
        client.close()


def print_analysis(analysis: dict):
    """Print a formatted summary of the analysis."""
    print("\n" + "="*60)
    print("📞 CALL ANALYSIS")
    print("="*60)

    print(f"\n🏢 Company: {analysis.get('company_name', 'N/A')}")
    print(f"👤 Owner: {analysis.get('owner_name', 'N/A')}")
    receptionist = analysis.get('receptionist_name')
    if receptionist:
        print(f"👩 Receptionist: {receptionist}")
    print(f"📱 Recipient: {analysis.get('recipients', 'N/A')}")
    print(f"⏱️  Duration: {analysis.get('call_duration_estimate', 'N/A')}")

    outcome = analysis.get('call_outcome', 'N/A')
    interest = analysis.get('interest_level', 0)
    print(f"\n📊 Outcome: {outcome}")
    print(f"🔥 Interest Level: {'🟢' * interest}{'⚪' * (10-interest)} ({interest}/10)")

    # Show callback info if detected
    if analysis.get('callback_requested'):
        print(f"\n📆 Callback Requested: Yes")
        if analysis.get('callback_notes'):
            print(f"   Notes: {analysis.get('callback_notes')}")

    print(f"\n📝 Summary:\n   {analysis.get('call_summary', 'N/A')}")

    if analysis.get('objections'):
        print("\n❌ Objections:")
        for obj in analysis['objections']:
            print(f"   • {obj}")

    if analysis.get('pain_points'):
        print("\n💡 Pain Points:")
        for pain in analysis['pain_points']:
            print(f"   • {pain}")

    if analysis.get('follow_up_actions'):
        print("\n✅ Follow-up Actions:")
        for action in analysis['follow_up_actions']:
            print(f"   • {action}")

    print("\n" + "="*60)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Transcribe cold call recordings using Gemini AI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        'audio_file',
        help="Path to the audio file (mp3, wav, m4a, etc.)"
    )
    parser.add_argument(
        '--phone',
        help="Phone number of the company called (for matching/creating records)"
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help="Transcribe only, don't save to PocketBase"
    )
    parser.add_argument(
        '--json',
        action='store_true',
        help="Output raw JSON instead of formatted text"
    )
    parser.add_argument(
        '--legacy',
        action='store_true',
        help="Use legacy cold_calls workflow instead of new call_logs"
    )

    args = parser.parse_args()

    try:
        # Validate audio file
        audio_path = validate_audio_file(args.audio_file)

        # Transcribe with Gemini
        analysis = transcribe_with_gemini(audio_path)

        # Output results
        if args.json:
            print(json.dumps(analysis, indent=2))
        else:
            print_analysis(analysis)

        # Save to PocketBase unless dry-run
        if not args.dry_run:
            company, call_record, transcript, follow_up = save_to_pocketbase(
                analysis,
                args.phone,
                use_legacy=args.legacy
            )
            print(f"\n✅ Successfully saved to PocketBase!")

            if args.legacy:
                collection_name = 'cold_calls'
            else:
                collection_name = 'call_logs'

            print(f"   View in admin: {os.getenv('POCKETBASE_URL')}/_/#/collections/{collection_name}/records/{call_record['id']}")

            if follow_up:
                print(f"   Follow-up scheduled: {os.getenv('POCKETBASE_URL')}/_/#/collections/follow_ups/records/{follow_up['id']}")
        else:
            print("\n⚠️ Dry run mode - not saved to PocketBase")

        return 0

    except FileNotFoundError as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"❌ Unexpected error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
