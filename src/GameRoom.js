import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    collection,
    addDoc
} from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { db } from "./firebaseConfig";
import ChatBox from "./ChatBox/ChatBox";
import QRCodeComponent from "./QRCodeComponent";
import GameSettings from "./GameSettings";
import GameRound from "./GameRound";

function GameRoom() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const [participants, setParticipants] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [isRoomActive, setIsRoomActive] = useState(true);
    const [isUserJoined, setIsUserJoined] = useState(false);
    const [isRoomOwner, setIsRoomOwner] = useState(false);
    const [copyStatus, setCopyStatus] = useState('Invite Link');
    const [gameSettings, setGameSettings] = useState({ maxPlayers: 4, drawTime: 90, rounds: 3, wordCount: 3, hints: 2, customWords: '' });
    const auth = getAuth();

    const [gameStatus, setGameStatus] = useState({
        isGameActive: false,
        currentRound: 1,
        currentDrawer: null,
        timeRemaining: gameSettings.drawTime,
        completedDrawers: [],
        wordSelectionTime: 10,
        selectedWord: '',
        availableWords: [],
        revealedHints: [],
        nextHintTime: null,
        guessedPlayers: [], // New
        playerScores: participants.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {}) // New
    });

    // Function to join the room
    const joinRoom = useCallback(async (user) => {
        if (!user || isUserJoined) return;

        try {
            const roomRef = doc(db, "rooms", roomId);
            const roomSnap = await getDoc(roomRef);

            if (roomSnap.exists()) {
                const roomData = roomSnap.data();

                // Check if game is currently active
                if (roomData.gameStatus?.isGameActive) {
                    alert("Game is currently in progress. Cannot join right now.");
                    navigate("/");
                    return;
                }

                // Check if room has reached max players
                const maxPlayers = roomData.gameSettings?.maxPlayers || 4;
                if (roomData.participants.length >= maxPlayers) {
                    alert("Room is full. Cannot join.");
                    navigate("/");
                    return;
                }

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
                                isGuest: user.isGuest || false,
                                isOwner: false
                            }
                        ]
                    });
                }
                // Add a system message to the chat
                const messagesRef = collection(db, "rooms", roomId, "messages");
                await addDoc(messagesRef, {
                    text: `${user.name} has joined the room.`,
                    sender: {id: "system", name: "System"},
                    timestamp: new Date()
                });

                setIsUserJoined(true);
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

                // Check if current user is the owner
                if (currentUser) {
                    const userParticipant = roomData.participants.find(
                        p => p.id === currentUser.id
                    );

                    if (!userParticipant) {
                        setIsRoomActive(false);
                        navigate("/");
                        return;
                    }

                    setIsRoomOwner(userParticipant?.isOwner || false);
                }

                // Update game settings when they change
                if (roomData.gameSettings) {
                    setGameSettings(roomData.gameSettings);
                }

                if (roomData?.gameStatus) {
                    setGameStatus(roomData.gameStatus);
                }

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
    }, [roomId, navigate, currentUser]);

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
    }, [auth, joinRoom]);

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

                // Announce in the chat that the user left
                const messagesRef = collection(db, "rooms", roomId, "messages");
                await addDoc(messagesRef, {
                    text: `${currentUser.name} has left the room.`,
                    sender: {
                        id: "system",
                        name: "System"
                    },
                    timestamp: new Date()
                });

                // If the owner is leaving and there are other participants
                if (isRoomOwner && updatedParticipants.length > 0) {
                    // Transfer ownership to the first participant
                    updatedParticipants[0].isOwner = true;
                    await updateDoc(roomRef, {
                        participants: updatedParticipants,
                        ownerName: updatedParticipants[0].name
                    });
                }
                // If the owner is leaving and no participants remain
                else if (isRoomOwner) {
                    // Delete the room
                    await deleteDoc(roomRef);
                }
                // If not the owner, just update participants
                else {
                    await updateDoc(roomRef, {
                        participants: updatedParticipants
                    });
                }
            }
        } catch (error) {
            console.error("Error leaving room:", error);
        }
    }, [currentUser, roomId, isRoomOwner]);

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

    // Invite Link Handler
    const handleInviteLink = useCallback(() => {
        // Generate an invite link with roomId as a query parameter
        const inviteLink = `${window.location.origin}/?roomId=${roomId}`;

        // Use the Clipboard API to copy the link
        navigator.clipboard.writeText(inviteLink)
            .then(() => {
                // Update button text to show successful copy
                setCopyStatus('Copied!');

                // Reset button text after 2 seconds
                setTimeout(() => {
                    setCopyStatus('Invite Link');
                }, 2000);
            })
            .catch(err => {
                console.error('Failed to copy: ', err);
                alert('Failed to copy invite link');
            });
    }, [roomId]);

    const removeParticipant = async (participantId) => {
        if (!isRoomOwner || !roomId) {
            alert("Only the room owner can remove participants.");
            return;
        }

        try {
            const roomRef = doc(db, "rooms", roomId);
            const roomSnap = await getDoc(roomRef);

            if (roomSnap.exists()) {
                const roomData = roomSnap.data();

                const updatedParticipants = roomData.participants.filter(
                    (participant) => participant.id !== participantId
                );

                await updateDoc(roomRef, {
                    participants: updatedParticipants,
                });

                // Announce the removal in the chat
                const removedParticipant = roomData.participants.find(
                    (p) => p.id === participantId
                );
                const messagesRef = collection(db, "rooms", roomId, "messages");
                await addDoc(messagesRef, {
                    text: `${removedParticipant.name} has been removed from the room by ${roomData.ownerName}.`,
                    sender: { id: "system", name: "System" },
                    timestamp: new Date(),
                });
            }
        } catch (error) {
            console.error("Error removing participant:", error);
            alert("Failed to remove participant.");
        }
    };

    const updateGameStatus = async (newState) => {
        try {
            const gameDocRef = doc(db, "rooms", roomId);

            // If the new state is a function (React updater), resolve it first
            const resolvedState = typeof newState === "function" ? newState(gameStatus) : newState;

            await updateDoc(gameDocRef, { gameStatus: resolvedState });
        } catch (error) {
            console.error("Error updating game status:", error);
        }
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
                        {p.name}
                        {p.isGuest ? " (Guest)" : ""}
                        {p.isOwner ? " 👑 (Owner)" : ""}
                        {isRoomOwner && !p.isOwner && (
                            <button
                                onClick={() => removeParticipant(p.id)}
                                style={{ marginLeft: "10px" }}
                            >
                                Remove
                            </button>
                        )}
                    </li>
                ))}
            </ul>
            <div>
                <button onClick={handleManualLeave}>Leave Room</button>
                <button onClick={handleInviteLink}>{copyStatus}</button>
                <QRCodeComponent />
            </div>
            {currentUser && (
                <ChatBox
                    roomId={roomId}
                    currentUser={currentUser}
                    gameSettings={gameSettings}
                    gameStatus={gameStatus}
                />
            )}
            <GameSettings
                roomId={roomId}
                isRoomOwner={isRoomOwner}
                initialSettings={gameSettings}
            />
            <GameRound
                roomId={roomId}
                participants={participants}
                gameSettings={gameSettings}
                currentUser={currentUser}
                isRoomOwner={isRoomOwner}
                gameStatus={gameStatus}
                updateGameStatus={updateGameStatus}
            />
        </div>
    );
}

export default GameRoom;