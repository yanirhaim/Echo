from tools.real_time_transcript import RealTimeTranscriber

def main():
    transcriber = RealTimeTranscriber()
    try:
        transcriber.start()
    except KeyboardInterrupt:
        print("\nStopping transcription...")
    finally:
        transcriber.stop()

if __name__ == "__main__":
    main()