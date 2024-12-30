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
import ChatBox from "./ChatBox";
import QRCodeComponent from "./QRCodeComponent";
import GameSettings from "./GameSettings";
import GameRound from "./GameRound";
import {Card, CardContent} from "@mui/material";
import Whiteboard from "./Whiteboard";


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
        <div style={styles.container}>
            <header style={styles.header}>
                <h1 style={styles.roomId}>Room ID: {roomId}</h1>
            </header>

            <div style={styles.main}>
                {/* Left Column: Game Settings */}
                <aside style={styles.leftColumn}>
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
                </aside>

                {/* Center Column: Whiteboard */}
                <section style={styles.centerColumn}>
                    {gameStatus.wordSelectionTime === 0 && (
                        <Whiteboard
                            roomId={roomId}
                            currentDrawer={gameStatus.currentDrawer}
                            currentUser={currentUser}
                            guessedPlayers={gameStatus.guessedPlayers}
                            participants={participants}
                        />
                    )}
                </section>

                {/* Right Column: Chat */}
                <aside style={styles.rightColumn}>
                    {currentUser && (
                        <ChatBox
                            roomId={roomId}
                            currentUser={currentUser}
                            gameSettings={gameSettings}
                            gameStatus={gameStatus}
                        />
                    )}
                </aside>
            </div>

            {/* Footer: Controls */}
            <footer style={styles.footer}>
                <button style={styles.actionButton} onClick={handleManualLeave}>
                    Leave Room
                </button>
                <button style={styles.actionButton} onClick={handleInviteLink}>
                    {copyStatus}
                </button>
                <div style={styles.qrCodeContainer}>
                    <QRCodeComponent />
                </div>
            </footer>
        </div>
    );
};

const styles = {
    container: {
        backgroundColor: "#B1F0F7",
        padding: "20px",
        borderRadius: "8px",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
        fontFamily: "Arial, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        minHeight: "100vh",
    },
    header: {
        textAlign: "center",
    },
    roomId: {
        color: "#333",
    },
    main: {
        display: "flex",
        flex: 1,
        gap: "20px",
    },
    leftColumn: {
        flex: "1",
        backgroundColor: "#F5F0CD",
        padding: "15px",
        borderRadius: "8px",
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
    },
    centerColumn: {
        flex: "2",
        backgroundColor: "#FFFFFF",
        padding: "15px",
        borderRadius: "8px",
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
    },
    rightColumn: {
        flex: "1",
        backgroundColor: "#F5F0CD",
        padding: "15px",
        borderRadius: "8px",
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
    },
    footer: {
        display: "flex",
        justifyContent: "center",
        gap: "10px",
        marginTop: "20px",
    },
    actionButton: {
        backgroundColor: "#FADA7A",
        border: "none",
        borderRadius: "8px",
        padding: "10px 15px",
        cursor: "pointer",
        fontWeight: "bold",
        color: "#333",
    },
    qrCodeContainer: {
        marginLeft: "10px",
    },
};

export default GameRoom;