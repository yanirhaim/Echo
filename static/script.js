// static/script.js
let audioContext = null;
let audioStream = null;
let workletNode = null;

const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const clearButton = document.getElementById('clearButton');
const transcriptContainer = document.getElementById('transcript-container');

// Helper function to create timestamp
function getTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString();
}

// Helper function to create a new transcript entry
function createTranscriptEntry(text, isPartial = false) {
    const entry = document.createElement('div');
    entry.className = `transcript-entry ${isPartial ? 'partial' : ''}`;
    
    if (isPartial) {
        entry.id = 'partial-transcript';
    } else {
        entry.id = `transcript-${Date.now()}`;
    }

    const timestamp = document.createElement('div');
    timestamp.className = 'transcript-timestamp';
    timestamp.textContent = getTimestamp();

    const transcriptText = document.createElement('div');
    transcriptText.className = 'transcript-text';
    transcriptText.textContent = isPartial ? `${text}...` : text;

    entry.appendChild(timestamp);
    entry.appendChild(transcriptText);

    return entry;
}

// Helper function to update or add translation
function addTranslation(transcriptId, translationText) {
    const transcriptEntry = document.getElementById(transcriptId);
    if (transcriptEntry) {
        let translationDiv = transcriptEntry.querySelector('.translation-text');
        if (!translationDiv) {
            translationDiv = document.createElement('div');
            translationDiv.className = 'translation-text';
            transcriptEntry.appendChild(translationDiv);
        }
        translationDiv.textContent = translationText;
    }
}

// Helper function to update partial transcript
function updatePartialTranscript(text) {
    let partialEntry = document.getElementById('partial-transcript');
    if (!partialEntry) {
        partialEntry = createTranscriptEntry(text, true);
        transcriptContainer.insertBefore(partialEntry, transcriptContainer.firstChild);
    } else {
        partialEntry.querySelector('.transcript-text').textContent = `${text}...`;
    }
}

// Helper function to finalize transcript
function finalizeTranscript(text) {
    const partialEntry = document.getElementById('partial-transcript');
    if (partialEntry) {
        partialEntry.remove();
    }

    const finalEntry = createTranscriptEntry(text, false);
    window.currentTranscriptId = finalEntry.id;
    transcriptContainer.insertBefore(finalEntry, transcriptContainer.firstChild);
    transcriptContainer.scrollTop = 0;
}

async function initAudioWorklet() {
    try {
        audioContext = new AudioContext({ sampleRate: 16000 });
        await audioContext.audioWorklet.addModule('/static/audio-processor.worklet.js');
        return true;
    } catch (error) {
        console.error('Error initializing audio worklet:', error);
        return false;
    }
}

async function startRecording() {
    try {
        if (!window.roomManager || !window.roomManager.isHost) {
            console.error('Must be a room host to record');
            return;
        }

        if (!audioContext) {
            const initialized = await initAudioWorklet();
            if (!initialized) {
                throw new Error('Failed to initialize audio worklet');
            }
        }

        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(audioStream);
        
        workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
        workletNode.port.onmessage = (event) => {
            if (window.roomManager.socket?.readyState === WebSocket.OPEN) {
                window.roomManager.socket.send(event.data);
            }
        };
        
        source.connect(workletNode);
        workletNode.connect(audioContext.destination);
        
        startButton.disabled = true;
        stopButton.disabled = false;
        
    } catch (error) {
        console.error('Error starting recording:', error);
        stopRecording();
    }
}

function stopRecording() {
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
    }
    if (workletNode) {
        workletNode.disconnect();
        workletNode = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    startButton.disabled = false;
    stopButton.disabled = true;
    audioStream = null;
}

function clearTranscripts() {
    transcriptContainer.innerHTML = '';
    window.currentTranscriptId = null;
}

// Handle WebSocket messages for transcripts and translations
window.handleTranscriptMessage = function(data) {
    switch(data.type) {
        case 'partial':
            updatePartialTranscript(data.text);
            break;
        case 'final':
            finalizeTranscript(data.text);
            break;
        case 'translation':
            if (window.currentTranscriptId) {
                addTranslation(window.currentTranscriptId, data.text);
            }
            break;
    }
};

// Only show recording controls for host
function updateControlsVisibility() {
    const isHost = window.roomManager?.isHost || false;
    startButton.style.display = isHost ? 'inline-block' : 'none';
    stopButton.style.display = isHost ? 'inline-block' : 'none';
}

startButton.onclick = startRecording;
stopButton.onclick = stopRecording;
clearButton.onclick = clearTranscripts;

// Update controls visibility when room manager loads or room status changes
document.addEventListener('DOMContentLoaded', () => {
    // Initial visibility update
    updateControlsVisibility();

    // Create a MutationObserver to watch for changes in room status
    const roomStatusObserver = new MutationObserver(() => {
        updateControlsVisibility();
    });

    // Start observing room status element
    const roomStatus = document.getElementById('roomStatus');
    roomStatusObserver.observe(roomStatus, { childList: true, characterData: true, subtree: true });
});