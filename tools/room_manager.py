from dataclasses import dataclass, field
from typing import Dict, Optional, Set, Union
from datetime import datetime, timedelta
import random
import string

@dataclass
class Room:
    """Data class representing a room in the system."""
    code: str
    host_id: str
    created_at: datetime
    guests: Set[str]
    max_participants: int = 50
    is_active: bool = True
    user_last_active: Dict[str, datetime] = field(default_factory=dict)

class RoomManager:
    """Manages room creation, joining, and state management."""
    
    def __init__(self):
        self._rooms: Dict[str, Room] = {}
        self._user_to_room: Dict[str, str] = {}  # Maps user IDs to room codes
        
    def generate_room_code(self, length: int = 5) -> str:
        """Generate a unique room code."""
        while True:
            # Generate a random code using uppercase letters
            code = ''.join(random.choices(string.ascii_uppercase, k=length))
            # Ensure it's unique
            if code not in self._rooms:
                return code

    def cleanup_inactive_users(self, max_inactive_time: int = 5 * 60):  # 5 minutes
        """Remove users who have been inactive for too long."""
        current_time = datetime.now()
        
        for room_code, room in list(self._rooms.items()):
            if not room.is_active:
                continue
            
            # Check host
            host_inactive = (
                room.user_last_active.get(room.host_id, datetime.min) + 
                timedelta(seconds=max_inactive_time) < current_time
            )
            
            if host_inactive:
                # If host is inactive, deactivate the entire room
                room.is_active = False
                for user in list(room.guests) + [room.host_id]:
                    if user in self._user_to_room:
                        del self._user_to_room[user]
                continue
            
            # Check guests
            for guest in list(room.guests):
                guest_inactive = (
                    room.user_last_active.get(guest, datetime.min) + 
                    timedelta(seconds=max_inactive_time) < current_time
                )
                
                if guest_inactive:
                    room.guests.remove(guest)
                    if guest in self._user_to_room:
                        del self._user_to_room[guest]
    
    def create_room(self, host_id: str, max_participants: int = 50) -> Room:
        """Create a new room with the given host."""
        if host_id in self._user_to_room:
            raise ValueError("User is already in a room")
        
        code = self.generate_room_code()
        room = Room(
            code=code,
            host_id=host_id,
            created_at=datetime.now(),
            guests=set(),
            max_participants=max_participants
        )
        
        self._rooms[code] = room
        self._user_to_room[host_id] = code
        return room
    
    def join_room(self, room_code: str, user_id: str) -> Room:
        """Add a user to a room as a guest."""
        room = self._rooms.get(room_code)
        if not room:
            raise ValueError("Room not found")
        
        if not room.is_active:
            raise ValueError("Room is no longer active")
            
        if user_id in self._user_to_room:
            raise ValueError("User is already in a room")
            
        if len(room.guests) >= room.max_participants:
            raise ValueError("Room is full")
            
        room.guests.add(user_id)
        room.user_last_active[user_id] = datetime.now()
        self._user_to_room[user_id] = room_code
        return room
    
    def leave_room(self, user_id: str) -> None:
        """Remove a user from their current room."""
        room_code = self._user_to_room.get(user_id)
        if not room_code:
            return
            
        room = self._rooms[room_code]
        
        if user_id == room.host_id:
            # If host leaves, close the room
            room.is_active = False
            # Remove all users from the room
            for guest in room.guests:
                del self._user_to_room[guest]
            del self._user_to_room[user_id]
            # Keep room in _rooms for history but marked as inactive
        else:
            # Remove guest from room
            room.guests.remove(user_id)
            del self._user_to_room[user_id]
        # Ensure user is removed from _user_to_room
        if user_id in self._user_to_room:
            del self._user_to_room[user_id]
    
    def get_room(self, room_code: str) -> Optional[Room]:
        """Get room information by code."""
        return self._rooms.get(room_code)
    
    def get_user_room(self, user_id: str) -> Optional[Room]:
        """Get the room a user is currently in."""
        room_code = self._user_to_room.get(user_id)
        if room_code:
            return self._rooms.get(room_code)
        return None
    
    def is_room_host(self, room_code: str, user_id: str) -> bool:
        """Check if a user is the host of a room."""
        room = self._rooms.get(room_code)
        return room and room.host_id == user_id
    
    def cleanup_inactive_rooms(self, max_age_hours: int = 24) -> None:
        """Remove inactive rooms older than max_age_hours."""
        cutoff_time = datetime.now() - timedelta(hours=max_age_hours)
        
        # Find rooms to remove
        to_remove = [
            code for code, room in self._rooms.items()
            if not room.is_active and room.created_at < cutoff_time
        ]
        
        # Remove the rooms
        for code in to_remove:
            del self._rooms[code]