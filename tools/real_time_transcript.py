import os
import assemblyai as aai
from dotenv import load_dotenv
import json
from fastapi import WebSocket
import asyncio
import queue
import threading
from datetime import datetime

from tools.text_translation import translate

class RealTimeTranscriber:
    def __init__(self, websocket: WebSocket, room_code: str, connection_manager, sample_rate=16_000):
        self.websocket = websocket
        self.room_code = room_code
        self.connection_manager = connection_manager
        self.sample_rate = sample_rate
        self._initialize_api()
        self.audio_queue = queue.Queue()
        self.is_running = True
        self.loop = asyncio.get_event_loop()
        self._setup_transcriber()
        
    def _initialize_api(self):
        """Initialize AssemblyAI API with key from environment variables."""
        load_dotenv()
        aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
        if not aai.settings.api_key:
            raise ValueError("ASSEMBLYAI_API_KEY not found in environment variables")

    async def _send_message(self, message_type: str, text: str, additional_data: dict = None):
        """Helper method to broadcast messages to all room members."""
        try:
            message = {
                "type": message_type,
                "text": text,
                "timestamp": datetime.now().isoformat()
            }
            if additional_data:
                message.update(additional_data)
                
            # Broadcast to all users in the room
            await self.connection_manager.broadcast_to_room(self.room_code, message)
        except Exception as e:
            print(f"Error sending message: {e}")

    def _on_data(self, transcript: aai.RealtimeTranscript):
        """Callback when transcript data is received."""
        if not transcript.text:
            return

        asyncio.run_coroutine_threadsafe(
            self._handle_transcript(transcript), 
            self.loop
        )

    async def _handle_transcript(self, transcript: aai.RealtimeTranscript):
        """Handle incoming transcript data asynchronously."""
        try:
            if isinstance(transcript, aai.RealtimeFinalTranscript):
                # Send final transcript
                await self._send_message(
                    "final",
                    transcript.text,
                    {"confidence": transcript.confidence}
                )
                
                try:
                    # Get and send translation
                    translation = await translate(transcript.text, language="Afrikaans")
                    if translation:
                        await self._send_message(
                            "translation",
                            translation,
                            {"original_text": transcript.text}
                        )
                    else:
                        await self._send_message(
                            "error",
                            "Translation failed: No response received"
                        )
                except Exception as e:
                    print(f"Translation error: {e}")
                    await self._send_message(
                        "error",
                        f"Translation error: {str(e)}"
                    )
            else:
                # Send partial transcript
                await self._send_message(
                    "partial",
                    transcript.text,
                    {"is_final": False}
                )
        except Exception as e:
            print(f"Error handling transcript: {e}")
            await self._send_message(
                "error",
                f"Transcript handling error: {str(e)}"
            )

    def _on_error(self, error: aai.RealtimeError):
        """Callback when an error occurs."""
        asyncio.run_coroutine_threadsafe(
            self._send_message("error", str(error)),
            self.loop
        )

    def _setup_transcriber(self):
        """Set up the real-time transcriber with callbacks."""
        self.transcriber = aai.RealtimeTranscriber(
            sample_rate=self.sample_rate,
            on_data=self._on_data,
            on_error=self._on_error
        )

    async def connect(self):
        """Connect to the AssemblyAI service."""
        try:
            self.transcriber.connect()
            # Start the audio processing thread
            self.process_thread = threading.Thread(target=self._process_audio_queue)
            self.process_thread.start()
            await self._send_message("status", "Connected to transcription service")
        except Exception as e:
            print(f"Error connecting to AssemblyAI: {e}")
            await self._send_message("error", f"Connection error: {str(e)}")

    def _process_audio_queue(self):
        """Process audio data from the queue in a separate thread."""
        while self.is_running:
            try:
                audio_data = self.audio_queue.get(timeout=1)
                self.transcriber.stream(audio_data)
            except queue.Empty:
                continue
            except Exception as e:
                print(f"Error processing audio: {e}")
                asyncio.run_coroutine_threadsafe(
                    self._send_message("error", f"Processing error: {str(e)}"),
                    self.loop
                )

    def process_audio(self, audio_data: bytes):
        """Add audio data to the processing queue."""
        if self.is_running:
            self.audio_queue.put(audio_data)

    def stop(self):
        """Stop the transcription session."""
        self.is_running = False
        try:
            self.transcriber.close()
            if hasattr(self, 'process_thread'):
                self.process_thread.join()
            asyncio.run_coroutine_threadsafe(
                self._send_message("status", "Transcription service disconnected"),
                self.loop
            )
        except Exception as e:
            print(f"Error while closing transcriber: {e}")