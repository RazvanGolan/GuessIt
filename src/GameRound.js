import React, { useState, useEffect, useRef } from 'react';
import {doc, collection, addDoc, getDoc} from "firebase/firestore";
import { db } from "./firebaseConfig";

const GameRound = ({ roomId, participants, gameSettings, currentUser, isRoomOwner, gameStatus, updateGameStatus }) => {
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
                availableWords: selectedWords,
                revealedHints: [],
                nextHintTime: null,
                guessedPlayers: [],
                playerScores: participants.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {})
            };

            updateGameStatus(initialGameStatus);

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
        if (!word || gameStatus.currentDrawer !== currentUser.id) return;

        try {
            const hintTimes = calculateHintTimes(gameSettings.drawTime, gameSettings.hints);

            const updatedGameStatus = {
                ...gameStatus,
                selectedWord: word,
                wordSelectionTime: 0,
                revealedHints: [],
                nextHintTime: hintTimes[0] || null
            };

            updateGameStatus(updatedGameStatus);

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

        if (gameStatus.isGameActive) {
            timer = setInterval(() => {
                updateGameStatus(prev => {
                    // Word selection countdown
                    if (prev.wordSelectionTime > 0) {
                        if (
                            prev.wordSelectionTime === 1 &&
                            !prev.selectedWord &&
                            prev.currentDrawer === currentUser.id &&
                            !isProcessing.current
                        ) {
                            isProcessing.current = true;
                            selectWord(prev.availableWords[0]).finally(() => {
                                isProcessing.current = false;
                            });
                        }
                        return {
                            ...prev,
                            wordSelectionTime: Math.max(prev.wordSelectionTime - 1, 0),
                        };
                    }

                    // Drawing countdown
                    if (prev.wordSelectionTime === 0 && prev.timeRemaining > 0) {
                        if (prev.nextHintTime === prev.timeRemaining && prev.selectedWord) {
                            const newPosition = getRandomUnrevealedPosition(
                                prev.selectedWord,
                                prev.revealedHints
                            );
                            if (newPosition !== null) {
                                const hintTimes = calculateHintTimes(
                                    gameSettings.drawTime,
                                    gameSettings.hints
                                );
                                const nextTime = hintTimes.find(time => time < prev.timeRemaining);

                                return {
                                    ...prev,
                                    revealedHints: [...prev.revealedHints, newPosition],
                                    nextHintTime: nextTime || null,
                                    timeRemaining: Math.max(prev.timeRemaining - 1, 0),
                                };
                            }
                        }
                        return {
                            ...prev,
                            timeRemaining: Math.max(prev.timeRemaining - 1, 0),
                        };
                    }

                    // Handle time expiration
                    if (prev.timeRemaining === 0 && !isProcessing.current) {
                        isProcessing.current = true;
                        handleTimeExpired().finally(() => {
                            isProcessing.current = false;
                        });
                    }

                    return prev; // Return state unchanged if no conditions are met
                });
            }, 1000);
        }

        // Clear timer on cleanup
        return () => clearInterval(timer);
    }, [gameStatus.isGameActive, gameStatus.timeRemaining, gameStatus.wordSelectionTime]);


    // Handle time expiration or drawer change
    const handleTimeExpired = async () => {
        if (!isRoomOwner) return;

        try {
            // Add current drawer to completed drawers
            const updatedCompletedDrawers = [
                ...gameStatus.completedDrawers,
                gameStatus.currentDrawer,
            ];

            // Determine next drawer
            const remainingDrawers = participants.filter(
                (p) => !updatedCompletedDrawers.includes(p.id)
            );

            let updatedGameStatus;

            if (remainingDrawers.length > 0) {
                // Move to next drawer in the same round
                const nextDrawer = remainingDrawers[0];
                const selectedWords = getRandomWords(words, gameSettings.wordCount);

                updatedGameStatus = {
                    ...gameStatus,
                    currentDrawer: nextDrawer.id,
                    timeRemaining: gameSettings.drawTime,
                    completedDrawers: updatedCompletedDrawers,
                    wordSelectionTime: 10,
                    selectedWord: null,
                    availableWords: selectedWords,
                };
            } else {
                // All players have drawn in this round
                const newRound = gameStatus.currentRound + 1;

                if (newRound > gameSettings.rounds) {
                    // Game over
                    updatedGameStatus = {
                        ...gameStatus,
                        isGameActive: false,
                        currentRound: newRound - 1,
                        currentDrawer: null,
                        timeRemaining: 0,
                        completedDrawers: [],
                        wordSelectionTime: 0,
                        selectedWord: null,
                        availableWords: [],
                    };
                } else {
                    // Start next round
                    const firstDrawer = participants[0];
                    const selectedWords = getRandomWords(words, gameSettings.wordCount);

                    updatedGameStatus = {
                        ...gameStatus,
                        currentRound: newRound,
                        isGameActive: true,
                        currentDrawer: firstDrawer.id,
                        timeRemaining: gameSettings.drawTime,
                        completedDrawers: [],
                        wordSelectionTime: 10,
                        selectedWord: null,
                        availableWords: selectedWords,
                    };
                }
            }

            // Propagate updated game status to the local state
            updateGameStatus(updatedGameStatus);

            // Announce round or game progression
            const messagesRef = collection(db, "rooms", roomId, "messages");
            await addDoc(messagesRef, {
                text: !updatedGameStatus.isGameActive
                    ? "Game Over!"
                    : updatedGameStatus.currentRound > gameStatus.currentRound
                        ? `Round ${updatedGameStatus.currentRound} begins. ${
                            participants.find(
                                (p) => p.id === updatedGameStatus.currentDrawer
                            ).name
                        } is now choosing a word!`
                        : `${
                            participants.find(
                                (p) => p.id === updatedGameStatus.currentDrawer
                            ).name
                        } is now choosing a word!`,
                sender: { id: "system", name: "System" },
                timestamp: new Date(),
            });
        } catch (error) {
            console.error("Error handling time expiration:", error);
        }
    };


    useEffect(() => {
        if (gameStatus.isGameActive) {
            if (gameStatus.guessedPlayers.length === participants.length - 1 && // All non-drawers guessed
                !isProcessing.current
            ) {
                isProcessing.current = true;
                handleTimeExpired().finally(() => {
                    isProcessing.current = false;
                });
            }
        }
    }, [gameStatus.guessedPlayers, participants.length, gameStatus.isGameActive]);

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
            {gameStatus.isGameActive && (
                <div>
                    <h2>Round {gameStatus.currentRound} of {gameSettings.rounds}</h2>
                    <p>Current Drawer: {participants.find(p => p.id === gameStatus.currentDrawer)?.name}</p>

                    {/* Word Selection Phase */}
                    {currentUser?.id === gameStatus.currentDrawer && gameStatus.wordSelectionTime > 0 && (
                        <div>
                            <h3>Choose a word to draw! ({gameStatus.wordSelectionTime} seconds left)</h3>
                            <div>
                                {gameStatus.availableWords.map((word, index) => (
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
                    {gameStatus.wordSelectionTime === 0 && (
                        <div>
                            {currentUser?.id === gameStatus.currentDrawer ? (
                                <h3>You are drawing: {gameStatus.selectedWord}</h3>
                            ) : (
                                <div>
                                    <h3>Word to
                                        guess: {getMaskedWord(gameStatus.selectedWord, gameStatus.revealedHints)}</h3>
                                    <p>Hints
                                        remaining: {Math.max(0, (gameSettings.hints || 0) - (gameStatus.revealedHints?.length || 0))}</p>
                                </div>
                            )}
                            <p>Time Remaining: {gameStatus.timeRemaining} seconds</p>
                        </div>
                    )}

                    <div>
                        <h4>Drawing Order:</h4>
                        <ul>
                            {participants.map(p => (
                                <li
                                    key={p.id}
                                    style={{
                                        textDecoration: gameStatus.completedDrawers.includes(p.id)
                                            ? 'line-through'
                                            : 'none',
                                        fontWeight: p.id === gameStatus.currentDrawer
                                            ? 'bold'
                                            : 'normal'
                                    }}
                                >
                                    {p.name}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="scoreboard">
                        <h3>Scoreboard</h3>
                        <ul>
                            {participants.map(p => (
                                <li key={p.id}>
                                    {p.name}: {gameStatus.playerScores[p.id] || 0} points
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            {isRoomOwner && !gameStatus.isGameActive && (
                <button onClick={startGame}>
                    Start Game
                </button>
            )}
        </div>
    );
};

export default GameRound;