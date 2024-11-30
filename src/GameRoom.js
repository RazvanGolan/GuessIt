import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    onSnapshot
} from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { db } from "./firebaseConfig";

function GameRoom() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const [participants, setParticipants] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [isRoomActive, setIsRoomActive] = useState(true);
    const [isUserJoined, setIsUserJoined] = useState(false);
    const auth = getAuth();

    // Function to join the room
    const joinRoom = useCallback(async (user) => {
        if (!user || isUserJoined) return;

        try {
            const roomRef = doc(db, "rooms", roomId);
            const roomSnap = await getDoc(roomRef);

            if (roomSnap.exists()) {
                const roomData = roomSnap.data();

                // Check if user is already in the room
                const isAlreadyInRoom = roomData.participants.some(
                    participant => participant.id === user.id
                );

                if (!isAlreadyInRoom) {
                    // Add user to the room
                    await updateDoc(roomRef, {
                        participants: [
                            ...roomData.participants,
                            {
                                id: user.id,
                                name: user.name,
                                isGuest: user.isGuest || false
                            }
                        ]
                    });

                    setIsUserJoined(true);
                }
            } else {
                // Room doesn't exist
                alert("Room not found");
                navigate("/");
            }
        } catch (error) {
            console.error("Error joining room:", error);
            alert("Failed to join room");
            navigate("/");
        }
    }, [roomId, navigate, isUserJoined]);

    // Real-time room listener
    useEffect(() => {
        if (!roomId) return;

        // Set up a real-time listener on the room document
        const roomRef = doc(db, "rooms", roomId);
        const unsubscribe = onSnapshot(roomRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                const roomData = docSnapshot.data();

                // Update participants in real-time
                setParticipants(roomData.participants || []);

                // Check if room still exists
                if (!roomData.participants || roomData.participants.length === 0) {
                    setIsRoomActive(false);
                    navigate("/");
                }
            } else {
                // Room has been deleted
                setIsRoomActive(false);
                navigate("/");
            }
        }, (error) => {
            console.error("Error listening to room updates:", error);
            navigate("/");
        });

        return () => unsubscribe(); // Cleanup listener
    }, [roomId, navigate]);

    // Authentication and user setup
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
                joinRoom(userData);
            } else if (storedGuest) {
                const guestUser = JSON.parse(storedGuest);
                setCurrentUser(guestUser);
                joinRoom(guestUser);
            }
        });

        return () => unsubscribe();
    }, [auth]);

    // Leave room function
    const leaveRoom = useCallback(async () => {
        if (!currentUser || !roomId) return;

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
            event.preventDefault();
            await leaveRoom();
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [leaveRoom]);

    // Manual leave handler
    const handleManualLeave = async () => {
        await leaveRoom();
        navigate("/");
    };

    // Render the room UI
    if (!isRoomActive) {
        return <div>Room is no longer active. Redirecting...</div>;
    }

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