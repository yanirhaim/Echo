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

from tools.real_time_transcript import RealTimeTranscriber
from tools.text_translation import translate
from tools.room_manager import RoomManager

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
        await websocket.accept()
        self.active_connections[user_id] = websocket
        
    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            
    async def broadcast_to_room(self, room_code: str, message: dict, exclude_user: str = None):
        """Broadcast message to all users in a room."""
        room = room_manager.get_room(room_code)
        if not room:
            return
            
        # Get all users in the room (host + guests)
        users = {room.host_id} | room.guests
        
        # Send to all connected users in the room (except excluded user)
        for user_id in users:
            if user_id != exclude_user and user_id in self.active_connections:
                await self.active_connections[user_id].send_json(message)
                
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

connection_manager = ConnectionManager()

@app.middleware("http")
async def add_cross_origin_isolate_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.endswith(('.js', '.worklet.js')):
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
        if request.url.path.endswith('.worklet.js'):
            response.headers["Content-Type"] = "text/javascript"
    return response

@app.get("/", response_class=HTMLResponse)
async def get(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/api/rooms/create/{user_id}")
async def create_room(user_id: str):
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
    try:
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

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await connection_manager.connect(client_id, websocket)
    
    try:
        # Get user's room if they're in one
        room = room_manager.get_user_room(client_id)
        if not room:
            await websocket.close(code=4000, reason="Not in a room")
            return
            
        # Initialize transcriber if user is the host
        if room_manager.is_room_host(room.code, client_id):
            transcriber = RealTimeTranscriber(
                websocket=websocket,
                room_code=room.code,
                connection_manager=connection_manager
            )
            transcribers[client_id] = transcriber
            await transcriber.connect()
            
            # Notify room that host has connected
            await connection_manager.broadcast_to_room(
                room.code,
                {
                    "type": "host_status",
                    "status": "connected",
                    "timestamp": datetime.now().isoformat()
                }
            )
        
        while True:
            if room_manager.is_room_host(room.code, client_id):
                # Host: receive and process audio data
                data = await websocket.receive_bytes()
                transcribers[client_id].process_audio(data)
            else:
                # Guest: receive keep-alive messages
                data = await websocket.receive_json()
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                    
    except WebSocketDisconnect:
        connection_manager.disconnect(client_id)
        room_manager.leave_room(client_id)
        if client_id in transcribers:
            transcribers[client_id].stop()
            del transcribers[client_id]
        
        # If user was in a room, notify others
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
        print(f"Error in WebSocket connection: {e}")
        connection_manager.disconnect(client_id)
        room_manager.leave_room(client_id)
        if client_id in transcribers:
            transcribers[client_id].stop()
            del transcribers[client_id]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)