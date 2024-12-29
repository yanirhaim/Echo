// static/script.js
let socket = null;
let audioContext = null;
let audioStream = null;
let workletNode = null;

const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const transcriptDiv = document.getElementById('transcript');
const translationDiv = document.getElementById('translation');
const statusDiv = document.getElementById('status');

// Generate a unique client ID
const clientId = 'client_' + Math.random().toString(36).substr(2, 9);

async function initAudioWorklet() {
    try {
        audioContext = new AudioContext({ sampleRate: 16000 });
        // Update the path to the worklet file
        await audioContext.audioWorklet.addModule('/static/audio-processor.worklet.js');
        return true;
    } catch (error) {
        console.error('Error initializing audio worklet:', error);
        return false;
    }
}

async function startRecording() {
    try {
        // Connect WebSocket
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
                    transcriptDiv.textContent = data.text + '...';
                    break;
                case 'final':
                    transcriptDiv.textContent = data.text;
                    break;
                case 'translation':
                    translationDiv.textContent = data.text;
                    break;
                case 'error':
                    console.error('Server error:', data.text);
                    break;
            }
        };

        // Initialize audio worklet if not already done
        if (!audioContext) {
            const initialized = await initAudioWorklet();
            if (!initialized) {
                throw new Error('Failed to initialize audio worklet');
            }
        }

        // Get audio stream
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(audioStream);
        
        // Create and connect the worklet
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

startButton.onclick = startRecording;
stopButton.onclick = stopRecording;