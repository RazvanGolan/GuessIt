import React, {useState, useEffect, useRef} from 'react';
import { doc, updateDoc, onSnapshot, collection, addDoc } from "firebase/firestore";
import { db } from "./firebaseConfig";

const GameRound = ({ roomId, participants, gameSettings, currentUser, isRoomOwner }) => {
    const [gameState, setGameState] = useState({
        isGameActive: false,
        currentRound: 1,
        currentDrawer: null,
        timeRemaining: gameSettings.drawTime,
        completedDrawers: []
    });

    const isProcessing = useRef(false);

    // Start the game (only by room owner)
    const startGame = async () => {
        if (!isRoomOwner) return;

        try {
            const roomRef = doc(db, "rooms", roomId);

            // Select first drawer (first participant)
            const firstDrawer = participants[0];

            const initialGameStatus = {
                isGameActive: true,
                currentRound: 1,
                currentDrawer: firstDrawer.id,
                timeRemaining: gameSettings.drawTime,
                completedDrawers: []
            };

            await updateDoc(roomRef, {
                gameStatus: initialGameStatus
            });

            // Announce game start
            const messagesRef = collection(db, "rooms", roomId, "messages");
            await addDoc(messagesRef, {
                text: `Game is starting! First round begins. ${firstDrawer.name} is now drawing!`,
                sender: { id: "system", name: "System" },
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error starting game:", error);
        }
    };

    // Manage game timer and round progression
    useEffect(() => {
        let timer;

        if (gameState.isGameActive && gameState.timeRemaining > 0) {
            timer = setInterval(() => {
                setGameState(prev => ({
                    ...prev,
                    timeRemaining: prev.timeRemaining - 1
                }));
            }, 1000);
        } else if (gameState.timeRemaining === 0 && !isProcessing.current) {
            // Prevent multiple executions
            isProcessing.current = true;
            handleTimeExpired().finally(() => {
                isProcessing.current = false; // Reset after execution
            });
        }

        return () => clearInterval(timer);
    }, [gameState.isGameActive, gameState.timeRemaining]);

    // Handle time expiration or drawer change
    const handleTimeExpired = async () => {
        if (!isRoomOwner) return;

        try {
            const roomRef = doc(db, "rooms", roomId);

            // Add current drawer to completed drawers
            const updatedCompletedDrawers = [
                ...gameState.completedDrawers,
                gameState.currentDrawer
            ];

            // Determine next drawer
            const remainingDrawers = participants
                .filter(p => !updatedCompletedDrawers.includes(p.id));

            let updatedGameStatus;

            if (remainingDrawers.length > 0) {
                // Move to next drawer in the same round
                updatedGameStatus = {
                    ...gameState,
                    currentDrawer: remainingDrawers[0].id,
                    timeRemaining: gameSettings.drawTime,
                    completedDrawers: updatedCompletedDrawers
                };
            } else {
                // All players have drawn in this round
                const newRound = gameState.currentRound + 1;

                if (newRound > gameSettings.rounds) {
                    // Game over
                    updatedGameStatus = {
                        isGameActive: false,
                        currentRound: newRound - 1,
                        currentDrawer: null,
                        timeRemaining: 0,
                        completedDrawers: []
                    };
                } else {
                    // Start next round
                    updatedGameStatus = {
                        currentRound: newRound,
                        isGameActive: true,
                        currentDrawer: participants[0].id,
                        timeRemaining: gameSettings.drawTime,
                        completedDrawers: []
                    };
                }
            }

            await updateDoc(roomRef, {
                gameStatus: updatedGameStatus
            });

            // Announce round or game progression
            const messagesRef = collection(db, "rooms", roomId, "messages");
            await addDoc(messagesRef, {
                text: !updatedGameStatus.isGameActive
                    ? "Game Over! Final scores will be displayed."
                    : updatedGameStatus.currentRound > gameState.currentRound
                        ? `Round ${updatedGameStatus.currentRound} begins. ${participants.find(p => p.id === updatedGameStatus.currentDrawer).name} is now drawing!`
                        : `${participants.find(p => p.id === updatedGameStatus.currentDrawer).name} is now drawing!`,
                sender: { id: "system", name: "System" },
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error handling time expiration:", error);
        }
    };

    // Listen to game state changes
    useEffect(() => {
        if (!roomId) return;

        const roomRef = doc(db, "rooms", roomId);
        const unsubscribe = onSnapshot(roomRef, (doc) => {
            const roomData = doc.data();

            if (roomData?.gameStatus) {
                const gameStatus = roomData.gameStatus;

                setGameState({
                    isGameActive: gameStatus.isGameActive,
                    currentRound: gameStatus.currentRound,
                    currentDrawer: gameStatus.currentDrawer,
                    timeRemaining: gameStatus.timeRemaining,
                    completedDrawers: gameStatus.completedDrawers || []
                });
            }
        });

        return () => unsubscribe();
    }, [roomId]);

    // Render game status and current drawer
    return (
        <div className="game-round-status">
            {gameState.isGameActive && (
                <div>
                    <h2>Round {gameState.currentRound} of {gameSettings.rounds}</h2>
                    <p>Current Drawer: {participants.find(p => p.id === gameState.currentDrawer)?.name}</p>
                    <p>Time Remaining: {gameState.timeRemaining} seconds</p>

                    {currentUser?.id === gameState.currentDrawer && (
                        <div>
                            <h3>You are drawing!</h3>
                            {/* Add drawing canvas or word selection here */}
                        </div>
                    )}

                    <div>
                        <h4>Drawing Order:</h4>
                        <ul>
                            {participants.map(p => (
                                <li
                                    key={p.id}
                                    style={{
                                        textDecoration: gameState.completedDrawers.includes(p.id)
                                            ? 'line-through'
                                            : 'none',
                                        fontWeight: p.id === gameState.currentDrawer
                                            ? 'bold'
                                            : 'normal'
                                    }}
                                >
                                    {p.name}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            {isRoomOwner && !gameState.isGameActive && (
                <button onClick={startGame}>
                    Start Game
                </button>
            )}
        </div>
    );
};

export default GameRound;