import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { db } from "./firebaseConfig";

function GameRoom() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const [participants, setParticipants] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const auth = getAuth();

    // Create a reusable function to leave the room
    const leaveRoom = useCallback(async () => {
        if (!currentUser) return;

        try {
            const roomRef = doc(db, "rooms", roomId);
            const roomSnap = await getDoc(roomRef);

            if (roomSnap.exists()) {
                const roomData = roomSnap.data();

                // Filter out the current user from participants
                const updatedParticipants = roomData.participants.filter(
                    participant => participant.id !== currentUser.id
                );

                // If no participants left, delete the room
                if (updatedParticipants.length === 0) {
                    await deleteDoc(roomRef);
                    console.log("Room deleted as no participants remain");
                } else {
                    // Update the room document with the filtered participants
                    await updateDoc(roomRef, {
                        participants: updatedParticipants
                    });
                }
            }
        } catch (error) {
            console.error("Error leaving room:", error);
        }
    }, [currentUser, roomId]);

    // Handle page unload
    useEffect(() => {
        const handleBeforeUnload = async (event) => {
            event.preventDefault(); // Standard way to show browser prompt
            await leaveRoom(); // Remove user from room
        };

        // Add event listener
        window.addEventListener('beforeunload', handleBeforeUnload);

        // Cleanup function
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [leaveRoom]);

    // Existing useEffect for authentication and room data
    useEffect(() => {
        const storedGuest = localStorage.getItem("guestUser");

        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (firebaseUser) {
                const userData = {
                    id: firebaseUser.uid,
                    name: firebaseUser.displayName || firebaseUser.email,
                    email: firebaseUser.email,
                    isGuest: false
                };
                setCurrentUser(userData);
            } else if (storedGuest) {
                setCurrentUser(JSON.parse(storedGuest));
            }
        });

        if (roomId) {
            fetchRoomData();
        }

        return () => unsubscribe();
    }, [roomId, auth]);

    const fetchRoomData = async () => {
        console.log("Fetching room data for room ID:", roomId);

        const roomRef = doc(db, "rooms", roomId);
        const roomSnap = await getDoc(roomRef);

        if (roomSnap.exists()) {
            const roomData = roomSnap.data();
            console.log("Room data found:", roomData);

            const roomIdFromData = roomData.roomId;

            if (roomIdFromData.toString() === roomId) {
                setParticipants(roomData.participants);
            } else {
                console.error("Room ID mismatch. Expected:", roomId, "but found:", roomIdFromData);
            }
        } else {
            console.error("Room not found:", roomId);
        }
    };

    const handleManualLeave = async () => {
        await leaveRoom();
        navigate("/");
    };

    return (
        <div>
            <h1>Room ID: {roomId}</h1>
            <h2>Participants</h2>
            <ul>
                {participants.map((p) => (
                    <li key={p.id}>
                        {p.name} {p.isGuest ? "(Guest)" : ""}
                    </li>
                ))}
            </ul>
            <button onClick={handleManualLeave}>Leave Room</button>
        </div>
    );
}

export default GameRoom;