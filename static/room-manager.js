// static/room-manager.js

class RoomManager {
    constructor() {
        this.userId = 'user_' + Math.random().toString(36).substr(2, 9);
        this.roomCode = null;
        this.isHost = false;
        this.socket = null;
        
        // Initialize UI elements
        this.initializeUI();
        this.attachEventListeners();
    }
    
    initializeUI() {
        // Create room management container
        const container = document.createElement('div');
        container.className = 'room-management';
        container.innerHTML = `
            <div class="room-controls">
                <div id="roomStatus" class="status disconnected">Not in a room</div>
                <div class="button-group">
                    <button id="createRoomBtn" class="primary-button">Create Room</button>
                    <button id="joinRoomBtn" class="primary-button">Join Room</button>
                </div>
                <div id="joinRoomForm" class="hidden">
                    <input type="text" id="roomCodeInput" 
                           placeholder="Enter 5-letter room code"
                           maxlength="5"
                           pattern="[A-Z]{5}">
                    <button id="submitJoinBtn">Join</button>
                </div>
                <div id="roomInfo" class="hidden">
                    <div class="room-code">Room: <span id="currentRoomCode"></span></div>
                    <div class="participant-count">Participants: <span id="participantCount">0</span></div>
                    <button id="leaveRoomBtn" class="secondary-button">Leave Room</button>
                </div>
            </div>
        `;
        
        // Insert before the transcript container
        const transcriptContainer = document.getElementById('transcript-container');
        transcriptContainer.parentNode.insertBefore(container, transcriptContainer);
    }
    
    attachEventListeners() {
        // Create room button
        document.getElementById('createRoomBtn').onclick = () => this.createRoom();
        
        // Join room button shows the join form
        document.getElementById('joinRoomBtn').onclick = () => {
            const form = document.getElementById('joinRoomForm');
            form.classList.toggle('hidden');
        };
        
        // Submit join room form
        document.getElementById('submitJoinBtn').onclick = () => {
            const codeInput = document.getElementById('roomCodeInput');
            const code = codeInput.value.toUpperCase();
            if (code.length === 5) {
                this.joinRoom(code);
                document.getElementById('joinRoomForm').classList.add('hidden');
            }
        };
        
        // Leave room button
        document.getElementById('leaveRoomBtn').onclick = () => this.leaveRoom();
        
        // Format room code input to uppercase
        document.getElementById('roomCodeInput').addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
    }
    
    async createRoom() {
        try {
            const response = await fetch(`/api/rooms/create/${this.userId}`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error('Failed to create room');
            }
            
            const data = await response.json();
            this.roomCode = data.room_code;
            this.isHost = true;
            
            // Update UI
            this.updateRoomUI();
            // Connect WebSocket
            this.connectWebSocket();
            
        } catch (error) {
            console.error('Error creating room:', error);
            this.showError('Failed to create room');
        }
    }
    
    async joinRoom(roomCode) {
        try {
            const response = await fetch(`/api/rooms/join/${roomCode}/${this.userId}`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error('Failed to join room');
            }
            
            const data = await response.json();
            this.roomCode = data.room_code;
            this.isHost = false;
            
            // Update UI
            this.updateRoomUI();
            // Connect WebSocket
            this.connectWebSocket();
            
        } catch (error) {
            console.error('Error joining room:', error);
            this.showError('Failed to join room');
        }
    }
    
    leaveRoom() {
        if (this.socket) {
            this.socket.close();
        }
        this.roomCode = null;
        this.isHost = false;
        this.updateRoomUI();
    }
    
    connectWebSocket() {
        this.socket = new WebSocket(`ws://${window.location.host}/ws/${this.userId}`);
        
        this.socket.onopen = () => {
            this.updateStatus('Connected');
            if (!this.isHost) {
                // Start ping-pong for guests
                this.startPingPong();
            }
        };
        
        this.socket.onclose = () => {
            this.updateStatus('Disconnected');
            // Clear ping-pong interval if it exists
            if (this.pingInterval) {
                clearInterval(this.pingInterval);
            }
        };
        
        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };
    }
    
    startPingPong() {
        // Send ping every 30 seconds to keep connection alive
        this.pingInterval = setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    }
    
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'host_status':
                this.updateStatus(`Host ${data.status}`);
                break;
            case 'user_left':
                this.handleUserLeft(data);
                break;
            case 'participant_count':
                this.updateParticipantCount(data.count);
                break;
            // Handle other message types (transcripts, translations, etc.)
            default:
                // Forward to transcript handler if it exists
                if (window.handleTranscriptMessage) {
                    window.handleTranscriptMessage(data);
                }
        }
    }
    
    handleUserLeft(data) {
        if (data.user_id === this.userId) {
            this.leaveRoom();
        } else {
            this.updateParticipantCount(data.participant_count);
        }
    }
    
    updateRoomUI() {
        const roomInfo = document.getElementById('roomInfo');
        const createBtn = document.getElementById('createRoomBtn');
        const joinBtn = document.getElementById('joinRoomBtn');
        const joinForm = document.getElementById('joinRoomForm');
        const currentRoomCode = document.getElementById('currentRoomCode');
        const recordingControls = document.querySelector('.recording-controls');
        
        if (this.roomCode) {
            roomInfo.classList.remove('hidden');
            createBtn.disabled = true;
            joinBtn.disabled = true;
            joinForm.classList.add('hidden');
            currentRoomCode.textContent = this.roomCode;
            
            // Show/hide recording controls based on host status
            if (this.isHost) {
                recordingControls.classList.remove('hidden');
                document.getElementById('startButton').disabled = false;
                document.getElementById('stopButton').disabled = true;
            } else {
                recordingControls.classList.add('hidden');
            }
        } else {
            roomInfo.classList.add('hidden');
            createBtn.disabled = false;
            joinBtn.disabled = false;
            currentRoomCode.textContent = '';
            recordingControls.classList.add('hidden');
        }
    }
    
    updateStatus(status) {
        const statusDiv = document.getElementById('roomStatus');
        statusDiv.textContent = status;
        statusDiv.className = `status ${status.toLowerCase() === 'connected' ? 'connected' : 'disconnected'}`;
    }
    
    updateParticipantCount(count) {
        document.getElementById('participantCount').textContent = count;
    }
    
    showError(message) {
        // Add error display logic here
        console.error(message);
        alert(message);  // Replace with better UI feedback
    }
}

// Initialize room manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.roomManager = new RoomManager();
});