// static/script.js
let audioContext = null;
let audioStream = null;
let workletNode = null;

const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const clearButton = document.getElementById('clearButton');
const transcriptContainer = document.getElementById('transcript-container');

console.log('Script loaded'); // Debug log

function getTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString();
}

function createTranscriptEntry(text, isPartial = false) {
    console.log('Creating transcript entry:', { text, isPartial }); // Debug log
    
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
    
    console.log('Created entry with ID:', entry.id); // Debug log
    return entry;
}

function addTranslation(transcriptId, translationText) {
    console.log('Adding translation:', { transcriptId, translationText }); // Debug log
    
    const transcriptEntry = document.getElementById(transcriptId);
    if (transcriptEntry) {
        console.log('Found transcript entry');
        let translationDiv = transcriptEntry.querySelector('.translation-text');
        if (!translationDiv) {
            console.log('Creating new translation div');
            translationDiv = document.createElement('div');
            translationDiv.className = 'translation-text';
            transcriptEntry.appendChild(translationDiv);
        }
        translationDiv.textContent = translationText;
        console.log('Translation added successfully');
    } else {
        console.warn('Transcript entry not found:', transcriptId);
    }
}

function updatePartialTranscript(text) {
    console.log('Updating partial transcript:', text); // Debug log
    
    let partialEntry = document.getElementById('partial-transcript');
    if (!partialEntry) {
        console.log('Creating new partial entry');
        partialEntry = createTranscriptEntry(text, true);
        transcriptContainer.insertBefore(partialEntry, transcriptContainer.firstChild);
    } else {
        console.log('Updating existing partial entry');
        partialEntry.querySelector('.transcript-text').textContent = `${text}...`;
    }
}

function finalizeTranscript(text) {
    console.log('Finalizing transcript:', text); // Debug log
    
    const partialEntry = document.getElementById('partial-transcript');
    if (partialEntry) {
        partialEntry.remove();
    }

    const finalEntry = createTranscriptEntry(text, false);
    window.currentTranscriptId = finalEntry.id;
    console.log('Set current transcript ID:', window.currentTranscriptId); // Debug log
    transcriptContainer.insertBefore(finalEntry, transcriptContainer.firstChild);
    transcriptContainer.scrollTop = 0;
}

window.handleTranscriptMessage = function(data) {
    console.log('Received WebSocket message:', data); // Debug log
    
    switch(data.type) {
        case 'partial':
            console.log('Processing partial transcript');
            updatePartialTranscript(data.text);
            break;
        case 'final':
            console.log('Processing final transcript');
            finalizeTranscript(data.text);
            break;
        case 'translation':
            console.log('Processing translation');
            if (window.currentTranscriptId) {
                console.log('Current transcript ID:', window.currentTranscriptId);
                addTranslation(window.currentTranscriptId, data.text);
            } else {
                console.warn('No current transcript ID found');
            }
            break;
        default:
            console.log('Unhandled message type:', data.type);
    }
};

async function startRecording() {
    console.log('Starting recording...'); // Debug log
    
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
        
        console.log('Recording started successfully'); // Debug log
        
    } catch (error) {
        console.error('Error starting recording:', error);
        stopRecording();
    }
}

function stopRecording() {
    console.log('Stopping recording...'); // Debug log
    
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
    
    console.log('Recording stopped'); // Debug log
}

function clearTranscripts() {
    console.log('Clearing transcripts'); // Debug log
    transcriptContainer.innerHTML = '';
    window.currentTranscriptId = null;
}

async function initAudioWorklet() {
    console.log('Initializing audio worklet...'); // Debug log
    try {
        audioContext = new AudioContext({ sampleRate: 16000 });
        await audioContext.audioWorklet.addModule('/static/audio-processor.worklet.js');
        console.log('Audio worklet initialized successfully'); // Debug log
        return true;
    } catch (error) {
        console.error('Error initializing audio worklet:', error);
        return false;
    }
}

startButton.onclick = startRecording;
stopButton.onclick = stopRecording;
clearButton.onclick = clearTranscripts;

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing controls visibility'); // Debug log
    updateControlsVisibility();
    
    const roomStatus = document.getElementById('roomStatus');
    const roomStatusObserver = new MutationObserver(() => {
        console.log('Room status changed, updating controls'); // Debug log
        updateControlsVisibility();
    });
    
    roomStatusObserver.observe(roomStatus, { 
        childList: true, 
        characterData: true, 
        subtree: true 
    });
});

function updateControlsVisibility() {
    const isHost = window.roomManager?.isHost || false;
    console.log('Updating controls visibility. Is host:', isHost); // Debug log
    startButton.style.display = isHost ? 'inline-block' : 'none';
    stopButton.style.display = isHost ? 'inline-block' : 'none';
}