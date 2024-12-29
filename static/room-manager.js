// static/room-manager.js

class RoomManager {
    constructor() {
        this.userId = 'user_' + Math.random().toString(36).substr(2, 9);
        this.roomCode = null;
        this.isHost = false;
        this.socket = null;
        this.userLanguage = null;
        this.supportedLanguages = [
            { code: 'af', name: 'Afrikaans' },
            { code: 'ar', name: 'Arabic' },
            { code: 'zh', name: 'Chinese' },
            { code: 'nl', name: 'Dutch' },
            { code: 'en', name: 'English' },
            { code: 'fr', name: 'French' },
            { code: 'de', name: 'German' },
            { code: 'hi', name: 'Hindi' },
            { code: 'id', name: 'Indonesian' },
            { code: 'it', name: 'Italian' },
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'pt', name: 'Portuguese' },
            { code: 'ru', name: 'Russian' },
            { code: 'es', name: 'Spanish' },
            { code: 'sw', name: 'Swahili' },
            { code: 'tr', name: 'Turkish' },
            { code: 'vi', name: 'Vietnamese' }
        ];
        this.pendingLanguage = null;
        this.initializeUI();
        this.attachEventListeners();

        // Extract room code from URL on initialization
        const urlParams = new URLSearchParams(window.location.search);
        this.roomCode = urlParams.get('room');
        
        // Determine if this is a host or participant view
        this.isHost = window.location.pathname.includes('host.html');

    }

    initializeUI() {
        this.updateRoomUI();
        this.updateLanguageUI();
    }

    attachEventListeners() {
        document.getElementById('createRoomBtn').onclick = () => this.createRoom();
        
        document.getElementById('joinRoomBtn').onclick = () => {
            document.getElementById('joinRoomForm').classList.toggle('hidden');
        };
        
        document.getElementById('submitJoinBtn').onclick = () => {
            const codeInput = document.getElementById('roomCodeInput');
            const code = codeInput.value.toUpperCase();
            if (code.length === 5) {
                this.joinRoom(code);
                document.getElementById('joinRoomForm').classList.add('hidden');
            }
        };
        
        document.getElementById('leaveRoomBtn').onclick = () => this.leaveRoom();
        
        document.getElementById('confirmLanguageBtn').onclick = () => {
            const select = document.getElementById('languageSelect');
            const languageCode = select.value;
            document.querySelector('.language-selection').classList.add('hidden');
            
            // Simply call completeRoomJoin with language code
            this.completeRoomJoin(languageCode);
        };

        const changeLanguageBtn = document.getElementById('changeLanguageBtn');
        if (changeLanguageBtn) {
            changeLanguageBtn.onclick = () => {
                document.querySelector('.language-selection').classList.remove('hidden');
            };
        }

        document.getElementById('roomCodeInput').addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });

        // Update language selection event listener
        document.getElementById('confirmLanguageBtn').onclick = () => {
            const select = document.getElementById('languageSelect');
            const languageCode = select.value;
            document.querySelector('.language-selection').classList.add('hidden');
            
            // First connect WebSocket, then set language
            this.completeRoomJoin(languageCode);
        };
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
            // Redirect to host view with room code
            window.location.href = `/host.html?room=${data.room_code}`;
            
        } catch (error) {
            console.error('Error creating room:', error);
            this.showError('Failed to create room');
        }
    }

    joinRoom(roomCode) {
        try {
            // Prevent multiple join attempts
            if (this.roomCode) {
                console.log('Already in a room, cannot join another');
                return;
            }
    
            fetch(`/api/rooms/join/${roomCode}/${this.userId}`, {
                method: 'POST'
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to join room');
                }
                return response.json();
            })
            .then(data => {
                // Redirect to participant view with room code
                window.location.href = `/participant.html?room=${data.room_code}`;
            })
            .catch(error => {
                console.error('Error joining room:', error);
                this.showError('Failed to join room');
            });
            
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
        this.userLanguage = null;
        this.updateRoomUI();
        this.updateLanguageUI();
    }

    setUserLanguage(languageCode) {
        console.log('Setting user language to:', languageCode);
        this.userLanguage = languageCode;
        this.updateLanguageUI();
        
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            console.log('Socket ready, sending language preference');
            const message = {
                type: 'language_preference',
                language: languageCode
            };
            console.log('Sending message:', message);
            this.socket.send(JSON.stringify(message));
        } else {
            console.error('Socket not ready:', {
                exists: !!this.socket,
                readyState: this.socket?.readyState
            });
        }
    }

    updateLanguageUI() {
        const currentLanguageInfo = document.getElementById('currentLanguageInfo');
        const currentLanguageDisplay = document.getElementById('currentLanguageDisplay');
        
        if (this.userLanguage && !this.isHost) {
            const language = this.supportedLanguages.find(l => l.code === this.userLanguage);
            if (language) {
                currentLanguageDisplay.textContent = language.name;
                currentLanguageInfo.classList.remove('hidden');
            }
        } else {
            currentLanguageInfo.classList.add('hidden');
        }
    }

    connectWebSocket() {
        console.log('Connecting WebSocket...');
        this.socket = new WebSocket(`ws://${window.location.host}/ws/${this.userId}`);
        
        this.socket.onopen = () => {
            console.log('WebSocket connected');
            this.updateStatus('Connected');
            if (!this.isHost) {
                this.startPingPong();
                // If we have a pending language preference, send it now
                if (this.userLanguage) {
                    console.log('Sending pending language preference');
                    this.setUserLanguage(this.userLanguage);
                }
            }
        };
        
        this.socket.onclose = () => {
            console.log('WebSocket disconnected');
            this.updateStatus('Disconnected');
            if (this.pingInterval) {
                clearInterval(this.pingInterval);
            }
        };
        
        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('Received WebSocket message:', data);
            this.handleWebSocketMessage(data);
        };
    }

    startPingPong() {
        this.pingInterval = setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    }

    handleWebSocketMessage(data) {
        console.log('Handling WebSocket message:', data);
        switch (data.type) {
            case 'host_status':
                console.log('Received host status update');
                this.updateStatus(`Host ${data.status}`);
                break;
            case 'user_left':
                console.log('User left event received');
                this.handleUserLeft(data);
                break;
            case 'participant_count':
                console.log('Updating participant count:', data.count);
                this.updateParticipantCount(data.count);
                break;
            case 'language_confirmed':
                console.log('Language preference confirmed:', data);
                this.showLanguageConfirmation(data.language);
                break;
            case 'error':
                console.error('Received error message:', data.text);
                this.showError(data.text);
                break;
            case 'translation':
                console.log('Translation received:', data);
                if (window.handleTranscriptMessage) {
                    window.handleTranscriptMessage(data);
                }
                break;
            case 'final':
            case 'partial':
                console.log('Transcript message received:', data.type);
                if (window.handleTranscriptMessage) {
                    window.handleTranscriptMessage(data);
                }
                break;
            default:
                console.log('Forwarding message to transcript handler:', data.type);
                if (window.handleTranscriptMessage) {
                    window.handleTranscriptMessage(data);
                }
        }
    }

    handleUserLeft(data) {
        if (data.user_id === this.userId) {
            this.leaveRoom();
        }
    }

    showLanguageConfirmation(language) {
        const languageName = this.supportedLanguages.find(l => l.code === language)?.name || language;
        this.showNotification(`Language set to: ${languageName}`);
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
            
            if (this.isHost) {
                recordingControls.classList.remove('hidden');
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
        statusDiv.className = `status ${status.toLowerCase().includes('connected') ? 'connected' : 'disconnected'}`;
    }

    updateParticipantCount(count) {
        document.getElementById('participantCount').textContent = count;
    }

    showError(message) {
        console.error(message);
        this.showNotification(message, 'error');
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    async completeRoomJoin(languageCode = null) {
        // Extract room code from URL
        const urlParams = new URLSearchParams(window.location.search);
        this.roomCode = urlParams.get('room');
        
        // Determine if this is a host or participant view
        this.isHost = window.location.pathname.includes('host.html');
    
        this.updateRoomUI();
    
        // Connect WebSocket first
        await this.connectWebSocket();
    
        // Set language after WebSocket is connected
        if (languageCode && !this.isHost) {
            this.setUserLanguage(languageCode);
        }
    }
}

// Initialize room manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.roomManager = new RoomManager();
});