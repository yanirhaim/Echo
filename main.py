from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import json
import asyncio
from typing import Dict
import queue
import threading

from tools.real_time_transcript import RealTimeTranscriber
from tools.text_translation import translate

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Store active connections
connections: Dict[str, WebSocket] = {}
transcribers: Dict[str, RealTimeTranscriber] = {}

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

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    connections[client_id] = websocket
    
    # Initialize transcriber for this connection
    transcriber = RealTimeTranscriber(websocket)
    transcribers[client_id] = transcriber
    await transcriber.connect()
    
    try:
        while True:
            # Receive audio data from the client
            data = await websocket.receive_bytes()
            transcriber.process_audio(data)
            
    except WebSocketDisconnect:
        # Cleanup on disconnect
        if client_id in connections:
            del connections[client_id]
        if client_id in transcribers:
            transcribers[client_id].stop()
            del transcribers[client_id]
    
    except Exception as e:
        print(f"Error in WebSocket connection: {e}")
        # Cleanup on error
        if client_id in connections:
            del connections[client_id]
        if client_id in transcribers:
            transcribers[client_id].stop()
            del transcribers[client_id]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)