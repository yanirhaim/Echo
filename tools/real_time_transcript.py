# tools/real_time_transcript.py
import os
import assemblyai as aai
from dotenv import load_dotenv

from tools.text_translation import translate

class RealTimeTranscriber:
    def __init__(self, sample_rate=16_000):
        self.sample_rate = sample_rate
        self._initialize_api()
        self._setup_transcriber()
        
    def _initialize_api(self):
        """Initialize AssemblyAI API with key from environment variables."""
        load_dotenv()
        aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
        if not aai.settings.api_key:
            raise ValueError("ASSEMBLYAI_API_KEY not found in environment variables")

    def _on_open(self, session_opened: aai.RealtimeSessionOpened):
        """Callback when session is opened."""
        print("Session ID:", session_opened.session_id)

    def _on_data(self, transcript: aai.RealtimeTranscript):
        """Callback when transcript data is received."""
        if not transcript.text:
            return

        if isinstance(transcript, aai.RealtimeFinalTranscript):
            print(transcript.text, end="\r\n")
            print("Translating:...")
            translation = translate(transcript.text, language="Afrikaans")
            print(f"Translation: {translation}")
        else:
            print(transcript.text, end="\r")

    def _on_error(self, error: aai.RealtimeError):
        """Callback when an error occurs."""
        print("An error occurred:", error)

    def _on_close(self):
        """Callback when session is closed."""
        print("Closing Session")

    def _setup_transcriber(self):
        """Set up the real-time transcriber with callbacks."""
        self.transcriber = aai.RealtimeTranscriber(
            sample_rate=self.sample_rate,
            on_data=self._on_data,
            on_error=self._on_error,
            on_open=self._on_open,
            on_close=self._on_close,
        )

    def start(self):
        """Start the transcription session."""
        try:
            self.transcriber.connect()
            microphone_stream = aai.extras.MicrophoneStream(sample_rate=self.sample_rate)
            self.transcriber.stream(microphone_stream)
        except Exception as e:
            print(f"Error during transcription: {e}")
            self.stop()

    def stop(self):
        """Stop the transcription session."""
        try:
            self.transcriber.close()
        except Exception as e:
            print(f"Error while closing transcriber: {e}")
