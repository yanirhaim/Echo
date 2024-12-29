// static/script.js
let socket = null;
let audioContext = null;
let audioStream = null;
let workletNode = null;
let currentTranscriptId = null;

const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const clearButton = document.getElementById('clearButton');
const statusDiv = document.getElementById('status');
const transcriptContainer = document.getElementById('transcript-container');

// Generate a unique client ID
const clientId = 'client_' + Math.random().toString(36).substr(2, 9);

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
        // Check if translation already exists
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
    // Remove partial transcript if it exists
    const partialEntry = document.getElementById('partial-transcript');
    if (partialEntry) {
        partialEntry.remove();
    }

    // Create new final transcript entry
    const finalEntry = createTranscriptEntry(text, false);
    currentTranscriptId = finalEntry.id;
    transcriptContainer.insertBefore(finalEntry, transcriptContainer.firstChild);

    // Scroll to the top
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
        socket = new WebSocket(`ws://${window.location.host}/ws/${clientId}`);
        
        socket.onopen = () => {
            statusDiv.textContent = 'Connected';
            statusDiv.className = 'status connected';
        };
        
        socket.onclose = () => {
            statusDiv.textContent = 'Disconnected';
            statusDiv.className = 'status disconnected';
            stopRecording();
        };
        
        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            switch(data.type) {
                case 'partial':
                    updatePartialTranscript(data.text);
                    break;
                case 'final':
                    finalizeTranscript(data.text);
                    break;
                case 'translation':
                    if (currentTranscriptId) {
                        addTranslation(currentTranscriptId, data.text);
                    }
                    break;
                case 'error':
                    console.error('Server error:', data.text);
                    break;
            }
        };

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
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(event.data);
            }
        };
        
        source.connect(workletNode);
        workletNode.connect(audioContext.destination);
        
        startButton.disabled = true;
        stopButton.disabled = false;
        
    } catch (error) {
        console.error('Error starting recording:', error);
        statusDiv.textContent = 'Error: ' + error.message;
        statusDiv.className = 'status disconnected';
    }
}

function stopRecording() {
    if (socket) {
        socket.close();
    }
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
    currentTranscriptId = null;
}

startButton.onclick = startRecording;
stopButton.onclick = stopRecording;
clearButton.onclick = clearTranscripts;