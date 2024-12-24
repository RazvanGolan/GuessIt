import React, { useState, useEffect, useRef } from 'react';
import {doc, updateDoc, onSnapshot, collection, addDoc, getDoc} from "firebase/firestore";
import { db } from "./firebaseConfig";

const GameRound = ({ roomId, participants, gameSettings, currentUser, isRoomOwner }) => {
    const [gameState, setGameState] = useState({
        isGameActive: false,
        currentRound: 1,
        currentDrawer: null,
        timeRemaining: gameSettings.drawTime,
        completedDrawers: [],
        wordSelectionTime: 10,
        selectedWord: '',
        availableWords: [],
        revealedHints: [],
        nextHintTime: null
    });


    const isProcessing = useRef(false);
    const [words, setWords] = useState(null);

    // Start the game (only by room owner)
    const startGame = async () => {
        if (!isRoomOwner) return;

        try {
            const wordsDocRef = doc(db, "words", "words");
            const docSnap = await getDoc(wordsDocRef);
            let defaultWords = [];
            if (docSnap.exists()) {
                defaultWords = docSnap.data().words || [];
            } else {
                console.error("No default words found in Firestore.");
            }

            const customWords = gameSettings.customWords
                ? gameSettings.customWords.split(",").map(word => word.trim())
                : [];

            const combinedWords = [...defaultWords, ...customWords];
            setWords(combinedWords);
            const roomRef = doc(db, "rooms", roomId);

            // Select first drawer (first participant)
            const firstDrawer = participants[0];

            // Select random words for the first drawer
            const selectedWords = getRandomWords(combinedWords, gameSettings.wordCount);

            const initialGameStatus = {
                isGameActive: true,
                currentRound: 1,
                currentDrawer: firstDrawer.id,
                timeRemaining: gameSettings.drawTime,
                completedDrawers: [],
                wordSelectionTime: 10,
                selectedWord: null,
                availableWords: selectedWords
            };

            await updateDoc(roomRef, {
                gameStatus: initialGameStatus
            });

            // Announce game start
            const messagesRef = collection(db, "rooms", roomId, "messages");
            await addDoc(messagesRef, {
                text: `Game is starting! First round begins. ${firstDrawer.name} is now choosing a word to draw!`,
                sender: { id: "system", name: "System" },
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error starting game:", error);
        }
    };

    // Helper function to get random words
    const getRandomWords = (wordList, count) => {
        const shuffled = [...wordList].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    };

    // Select a word for drawing
    const selectWord = async (word) => {
        if (!word || gameState.currentDrawer !== currentUser.id) return;

        try {
            const roomRef = doc(db, "rooms", roomId);
            const hintTimes = calculateHintTimes(gameSettings.drawTime, gameSettings.hints);

            const updatedGameStatus = {
                ...gameState,
                selectedWord: word,
                wordSelectionTime: 0,
                revealedHints: [],
                nextHintTime: hintTimes[0] || null
            };

            await updateDoc(roomRef, {
                gameStatus: updatedGameStatus
            });

            const messagesRef = collection(db, "rooms", roomId, "messages");
            await addDoc(messagesRef, {
                text: `${currentUser.name} has selected a word to draw!`,
                sender: { id: "system", name: "System" },
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error selecting word:", error);
        }
    };

    // Manage game timer and round progression
    useEffect(() => {
        let timer;

        if (gameState.isGameActive) {
            if (gameState.wordSelectionTime > 0) {
                timer = setInterval(() => {
                    setGameState(prev => {
                        if (prev.wordSelectionTime === 1 && !prev.selectedWord && prev.currentDrawer === currentUser.id && !isProcessing.current) {
                            isProcessing.current = true;
                            selectWord(prev.availableWords[0]).finally(() => {
                                isProcessing.current = false;
                            });
                        }
                        return {
                            ...prev,
                            wordSelectionTime: prev.wordSelectionTime - 1
                        };
                    });
                }, 1000);
            } else if (gameState.timeRemaining > 0) {
                timer = setInterval(() => {
                    setGameState(prev => {
                        // Check if it's time for a new hint
                        if (prev.nextHintTime === prev.timeRemaining && prev.selectedWord) {
                            const newPosition = getRandomUnrevealedPosition(prev.selectedWord, prev.revealedHints);
                            if (newPosition !== null) {
                                // Get next hint time from the remaining intervals
                                const hintTimes = calculateHintTimes(gameSettings.drawTime, gameSettings.hints);
                                const nextTime = hintTimes.find(time => time < prev.timeRemaining);

                                // Update game state in Firestore
                                if (isRoomOwner) {
                                    const roomRef = doc(db, "rooms", roomId);
                                    updateDoc(roomRef, {
                                        gameStatus: {
                                            ...prev,
                                            revealedHints: [...prev.revealedHints, newPosition],
                                            nextHintTime: nextTime || null,
                                            timeRemaining: prev.timeRemaining - 1
                                        }
                                    });
                                }

                                return {
                                    ...prev,
                                    revealedHints: [...prev.revealedHints, newPosition],
                                    nextHintTime: nextTime || null,
                                    timeRemaining: prev.timeRemaining - 1
                                };
                            }
                        }
                        return {
                            ...prev,
                            timeRemaining: prev.timeRemaining - 1
                        };
                    });
                }, 1000);
            } else if (gameState.timeRemaining === 0 && !isProcessing.current) {
                isProcessing.current = true;
                handleTimeExpired().finally(() => {
                    isProcessing.current = false;
                });
            }
        }

        return () => clearInterval(timer);
    }, [gameState.isGameActive, gameState.timeRemaining, gameState.wordSelectionTime]);


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
                const nextDrawer = remainingDrawers[0];

                // Select random words for the next drawer
                const selectedWords = getRandomWords(words, gameSettings.wordCount);

                updatedGameStatus = {
                    ...gameState,
                    currentDrawer: nextDrawer.id,
                    timeRemaining: gameSettings.drawTime,
                    completedDrawers: updatedCompletedDrawers,
                    wordSelectionTime: 10,
                    selectedWord: null,
                    availableWords: selectedWords
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
                        completedDrawers: [],
                        wordSelectionTime: 0,
                        selectedWord: null,
                        availableWords: []
                    };
                } else {
                    // Start next round
                    const firstDrawer = participants[0];
                    const selectedWords = getRandomWords(words, gameSettings.wordCount);

                    updatedGameStatus = {
                        currentRound: newRound,
                        isGameActive: true,
                        currentDrawer: firstDrawer.id,
                        timeRemaining: gameSettings.drawTime,
                        completedDrawers: [],
                        wordSelectionTime: 10,
                        selectedWord: null,
                        availableWords: selectedWords
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
                    ? "Game Over!"
                    : updatedGameStatus.currentRound > gameState.currentRound
                        ? `Round ${updatedGameStatus.currentRound} begins. ${participants.find(p => p.id === updatedGameStatus.currentDrawer).name} is now choosing a word!`
                        : `${participants.find(p => p.id === updatedGameStatus.currentDrawer).name} is now choosing a word!`,
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
                    isGameActive: gameStatus.isGameActive || false,
                    currentRound: gameStatus.currentRound || 1,
                    currentDrawer: gameStatus.currentDrawer || null,
                    timeRemaining: gameStatus.timeRemaining || gameSettings.drawTime,
                    completedDrawers: gameStatus.completedDrawers || [],
                    wordSelectionTime: gameStatus.wordSelectionTime || 0,
                    selectedWord: gameStatus.selectedWord || '',
                    availableWords: gameStatus.availableWords || [],
                    revealedHints: gameStatus.revealedHints || [],
                    nextHintTime: gameStatus.nextHintTime || null
                });
            }
        });

        return () => unsubscribe();
    }, [roomId]);

    // Calculate hint intervals based on draw time and number of hints
    const calculateHintTimes = (drawTime, numHints) => {
        if (!drawTime || !numHints) return [];
        const interval = Math.floor(drawTime / (numHints + 1));
        return Array.from({ length: numHints }, (_, i) => drawTime - interval * (i + 1));
    };

    // Get random unrevealed letter positions
    const getRandomUnrevealedPosition = (word, revealedPositions) => {
        if (!word || !revealedPositions) return null;

        const availablePositions = Array.from({ length: word.length })
            .map((_, i) => i)
            .filter(pos => !revealedPositions.includes(pos));

        if (availablePositions.length === 0) return null;

        const randomIndex = Math.floor(Math.random() * availablePositions.length);
        return availablePositions[randomIndex];
    };

    // Generate masked word with revealed hints
    const getMaskedWord = (word, revealedPositions) => {
        if (!word) return '';
        if (!revealedPositions) return '_ '.repeat(word.length).trim();

        return word
            .split('')
            .map((letter, index) => revealedPositions.includes(index) ? letter : '_')
            .join(' ');
    };

    // Render game status and current drawer
    return (
        <div className="game-round-status">
            {gameState.isGameActive && (
                <div>
                    <h2>Round {gameState.currentRound} of {gameSettings.rounds}</h2>
                    <p>Current Drawer: {participants.find(p => p.id === gameState.currentDrawer)?.name}</p>

                    {/* Word Selection Phase */}
                    {currentUser?.id === gameState.currentDrawer && gameState.wordSelectionTime > 0 && (
                        <div>
                            <h3>Choose a word to draw! ({gameState.wordSelectionTime} seconds left)</h3>
                            <div>
                                {gameState.availableWords.map((word, index) => (
                                    <button
                                        key={index}
                                        onClick={() => selectWord(word)}
                                    >
                                        {word}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Drawing Phase */}
                    {gameState.wordSelectionTime === 0 && (
                        <div>
                            {currentUser?.id === gameState.currentDrawer ? (
                                <h3>You are drawing: {gameState.selectedWord}</h3>
                            ) : (
                                <div>
                                    <h3>Word to guess: {getMaskedWord(gameState.selectedWord, gameState.revealedHints)}</h3>
                                    <p>Hints remaining: {Math.max(0, (gameSettings.hints || 0) - (gameState.revealedHints?.length || 0))}</p>
                                </div>
                            )}
                            <p>Time Remaining: {gameState.timeRemaining} seconds</p>
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