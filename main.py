from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import json
import asyncio
from typing import Dict, Optional
import queue
import threading
from datetime import datetime
import os
from dotenv import load_dotenv

from tools.real_time_transcript import RealTimeTranscriber
from tools.text_translation import translate
from tools.room_manager import RoomManager

# Load environment variables
load_dotenv()

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Initialize room manager
room_manager = RoomManager()

# Store active connections and transcribers
connections: Dict[str, WebSocket] = {}
transcribers: Dict[str, RealTimeTranscriber] = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        
    async def connect(self, user_id: str, websocket: WebSocket):
        """Connect a new user."""
        await websocket.accept()
        self.active_connections[user_id] = websocket
        print(f"User {user_id} connected. Total connections: {len(self.active_connections)}")
        
    def disconnect(self, user_id: str):
        """Disconnect a user."""
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            print(f"User {user_id} disconnected. Total connections: {len(self.active_connections)}")
    
    async def send_to_user(self, user_id: str, message: dict):
        """Send a message to a specific user."""
        print(f"Attempting to send message to user {user_id}")
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
                print(f"Successfully sent message to user {user_id}")
            except Exception as e:
                print(f"Error sending message to user {user_id}: {e}")
                raise
        else:
            print(f"User {user_id} not found in active connections")
                
    async def broadcast_to_room(self, room_code: str, message: dict, exclude_user: str = None):
        """Broadcast message to all users in a room."""
        room = room_manager.get_room(room_code)
        if not room:
            print(f"Room {room_code} not found")
            return
            
        users = {room.host_id} | room.guests
        print(f"Broadcasting to room {room_code} with {len(users)} users")
        
        for user_id in users:
            if user_id != exclude_user and user_id in self.active_connections:
                try:
                    await self.active_connections[user_id].send_json(message)
                    print(f"Broadcast message sent to user {user_id}")
                except Exception as e:
                    print(f"Error broadcasting to user {user_id}: {e}")
                    
    async def update_participant_count(self, room_code: str):
        """Broadcast updated participant count to all users in a room."""
        room = room_manager.get_room(room_code)
        if room:
            await self.broadcast_to_room(
                room_code,
                {
                    "type": "participant_count",
                    "count": len(room.guests) + 1,  # +1 for the host
                    "timestamp": datetime.now().isoformat()
                }
            )

# Initialize connection manager
connection_manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    async def periodic_cleanup():
        while True:
            await asyncio.sleep(300)  # Run every 5 minutes
            room_manager.cleanup_inactive_users()
    
    asyncio.create_task(periodic_cleanup())

@app.middleware("http")
async def add_cross_origin_isolate_headers(request, call_next):
    """Add necessary headers for AudioWorklet functionality."""
    response = await call_next(request)
    if request.url.path.endswith(('.js', '.worklet.js')):
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
        if request.url.path.endswith('.worklet.js'):
            response.headers["Content-Type"] = "text/javascript"
    return response

@app.get("/", response_class=HTMLResponse)
async def get(request: Request):
    """Render the main page."""
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/api/rooms/create/{user_id}")
async def create_room(user_id: str):
    """Create a new room."""
    try:
        room = room_manager.create_room(host_id=user_id)
        return {
            "status": "success",
            "room_code": room.code,
            "created_at": room.created_at.isoformat()
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/rooms/join/{room_code}/{user_id}")
async def join_room(room_code: str, user_id: str):
    """Join an existing room."""
    try:
        # First, remove user from any existing room
        room_manager.leave_room(user_id)
        
        # Then join the new room
        room = room_manager.join_room(room_code=room_code, user_id=user_id)
        
        # Broadcast participant update to all room members
        await connection_manager.update_participant_count(room_code)
        
        return {
            "status": "success",
            "room_code": room.code,
            "host_id": room.host_id,
            "participant_count": len(room.guests) + 1  # +1 for the host
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

def leave_room(self, user_id: str) -> None:
    """Remove a user from their current room."""
    room_code = self._user_to_room.get(user_id)
    if not room_code:
        return
        
    room = self._rooms.get(room_code)
    if not room:
        # Cleanup any orphaned user-to-room mapping
        del self._user_to_room[user_id]
        return
    
    if user_id == room.host_id:
        # If host leaves, close the room
        room.is_active = False
        # Remove all users from the room
        for guest in list(room.guests):
            if guest in self._user_to_room:
                del self._user_to_room[guest]
        if user_id in self._user_to_room:
            del self._user_to_room[user_id]
    else:
        # Remove guest from room
        if user_id in room.guests:
            room.guests.remove(user_id)
        if user_id in self._user_to_room:
            del self._user_to_room[user_id]

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await connection_manager.connect(client_id, websocket)
    print(f"WebSocket connected for client {client_id}")
    
    try:
        room = room_manager.get_user_room(client_id)
        if not room:
            print(f"No room found for client {client_id}")
            await websocket.close(code=4000, reason="Not in a room")
            return
        
        # Update last active timestamp
        room.user_last_active[client_id] = datetime.now()
            
        if room_manager.is_room_host(room.code, client_id):
            print(f"Client {client_id} is host of room {room.code}")
            transcriber = RealTimeTranscriber(
                websocket=websocket,
                room_code=room.code,
                connection_manager=connection_manager
            )
            transcribers[client_id] = transcriber
            await transcriber.connect()
            
            await connection_manager.broadcast_to_room(
                room.code,
                {
                    "type": "host_status",
                    "status": "connected",
                    "timestamp": datetime.now().isoformat()
                }
            )
        
        while True:
            # Periodically update last active timestamp
            room.user_last_active[client_id] = datetime.now()
            
            # Timeout for receiving messages to allow timestamp updates
            try:
                if room_manager.is_room_host(room.code, client_id):
                    data = await asyncio.wait_for(websocket.receive_bytes(), timeout=30.0)
                    transcribers[client_id].process_audio(data)
                else:
                    data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)
                    print(f"Received message from client {client_id}: {data}")
                    
                    if data.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                    elif data.get("type") == "language_preference":
                        language = data.get("language")
                        print(f"Setting language preference for {client_id}: {language}")
                        host_id = room.host_id
                        if host_id in transcribers:
                            await transcribers[host_id].set_user_language(client_id, language)
                        else:
                            print(f"Host transcriber not found for room {room.code}")
            
            except asyncio.TimeoutError:
                # Send a ping to keep the connection alive
                await websocket.send_json({"type": "ping"})
                continue
        
    except WebSocketDisconnect:
        print(f"WebSocket disconnected for client {client_id}")
        connection_manager.disconnect(client_id)
        
        # Do not immediately remove from room, let cleanup handle it
        if client_id in transcribers:
            transcribers[client_id].stop()
            del transcribers[client_id]
        
        if room:
            await connection_manager.broadcast_to_room(
                room.code,
                {
                    "type": "user_left",
                    "user_id": client_id,
                    "timestamp": datetime.now().isoformat()
                }
            )
    
    except Exception as e:
        print(f"Error in websocket connection for {client_id}: {str(e)}")
        connection_manager.disconnect(client_id)
        
        if client_id in transcribers:
            transcribers[client_id].stop()
            del transcribers[client_id]

@app.get("/host.html", response_class=HTMLResponse)
async def get_host_view(request: Request):
    return templates.TemplateResponse("host-view.html", {"request": request})

@app.get("/participant.html", response_class=HTMLResponse)
async def get_participant_view(request: Request):
    return templates.TemplateResponse("participant-view.html", {"request": request})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)