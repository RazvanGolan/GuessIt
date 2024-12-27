import React, {useState, useEffect, useRef, useCallback} from 'react';
import {doc, collection, addDoc, getDoc} from "firebase/firestore";
import { db } from "./firebaseConfig";

const GameRound = ({ roomId, participants, gameSettings, currentUser, isRoomOwner, gameStatus, updateGameStatus }) => {
    const isProcessing = useRef(false);
    const [words, setWords] = useState(null);
    const messageDebounceRef = useRef(null);

    const getRandomWords = (wordList, count) => {
        const shuffled = [...wordList].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    };

    const calculateHintTimes = (drawTime, numHints) => {
        if (!drawTime || !numHints) return [];
        const interval = Math.floor(drawTime / (numHints + 1));
        return Array.from({ length: numHints }, (_, i) => drawTime - interval * (i + 1));
    };

    const getRandomUnrevealedPosition = (word, revealedPositions) => {
        if (!word || !revealedPositions) return null;
        const availablePositions = Array.from({ length: word.length })
            .map((_, i) => i)
            .filter(pos => !revealedPositions.includes(pos));
        return availablePositions.length > 0
            ? availablePositions[Math.floor(Math.random() * availablePositions.length)]
            : null;
    };

    // Add message with debouncing
    const addSystemMessage = useCallback(async (message) => {
        // Clear any pending message
        if (messageDebounceRef.current) {
            clearTimeout(messageDebounceRef.current);
        }

        messageDebounceRef.current = setTimeout(async () => {
            try {
                const messagesRef = collection(db, "rooms", roomId, "messages");
                await addDoc(messagesRef, {
                    text: message,
                    sender: { id: "system", name: "System" },
                    timestamp: new Date()
                });
            } catch (error) {
                console.error("Error adding system message:", error);
            }
        }, 500); // Debounce time of 500ms
    }, [roomId]);

    const advanceGame = useCallback(async (reason = 'time_expired') => {
        if (!isRoomOwner || isProcessing.current) return;
        isProcessing.current = true;

        try {
            const updatedCompletedDrawers = [
                ...gameStatus.completedDrawers,
                gameStatus.currentDrawer,
            ];

            // Check if all players have drawn in this round
            const roundComplete = updatedCompletedDrawers.length === participants.length;

            let updatedGameStatus;
            let message = '';

            if (roundComplete) {
                // Start new round
                const newRound = gameStatus.currentRound + 1;

                if (newRound > gameSettings.rounds) {
                    // Game over
                    updatedGameStatus = {
                        ...gameStatus,
                        isGameActive: false,
                        currentRound: gameStatus.currentRound,
                        currentDrawer: null,
                        timeRemaining: 0,
                        completedDrawers: [],
                        wordSelectionTime: 0,
                        selectedWord: null,
                        availableWords: [],
                        guessedPlayers: [],
                        revealedHints: [],
                        nextHintTime: null
                    };
                    message = "Game Over!";
                } else {
                    // Reset for new round
                    const firstDrawer = participants[0];
                    const selectedWords = getRandomWords(words, gameSettings.wordCount);

                    updatedGameStatus = {
                        ...gameStatus,
                        currentRound: newRound,
                        currentDrawer: firstDrawer.id,
                        timeRemaining: gameSettings.drawTime,
                        completedDrawers: [], // Reset completed drawers for new round
                        wordSelectionTime: 10,
                        selectedWord: null,
                        availableWords: selectedWords,
                        guessedPlayers: [],
                        revealedHints: [],
                        nextHintTime: null
                    };
                    message = `Round ${newRound} begins! ${firstDrawer.name} is now choosing a word!`;
                }
            } else {
                // Continue current round with next drawer
                const remainingDrawers = participants.filter(
                    (p) => !updatedCompletedDrawers.includes(p.id)
                );
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
                    guessedPlayers: [],
                    revealedHints: [],
                    nextHintTime: null
                };
                message = `${nextDrawer.name} is now choosing a word!`;
            }

            await updateGameStatus(updatedGameStatus);

            // Add system message with debouncing
            const finalMessage = reason === 'all_guessed'
                ? `Everyone has guessed correctly! ${message}`
                : message;

            await addSystemMessage(finalMessage);

        } catch (error) {
            console.error("Error advancing game:", error);
        } finally {
            isProcessing.current = false;
        }
    }, [isRoomOwner, participants, gameStatus, words, gameSettings, updateGameStatus, addSystemMessage]);


    const selectWord = useCallback(async (word) => {
        if (!word || gameStatus.currentDrawer !== currentUser.id) return;

        try {
            const hintTimes = calculateHintTimes(gameSettings.drawTime, gameSettings.hints);

            const updatedGameStatus = {
                ...gameStatus,
                selectedWord: word,
                wordSelectionTime: 0,
                timeRemaining: gameSettings.drawTime,
                revealedHints: [],
                nextHintTime: hintTimes[0] || null,
                guessedPlayers: [] // Reset guessed players when new word is selected
            };

            await updateGameStatus(updatedGameStatus);

            const messagesRef = collection(db, "rooms", roomId, "messages");
            await addDoc(messagesRef, {
                text: `${currentUser.name} has selected a word to draw!`,
                sender: { id: "system", name: "System" },
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error selecting word:", error);
        }
    }, [currentUser?.id, gameStatus, gameSettings.drawTime, gameSettings.hints, updateGameStatus, roomId]);

    // Check if all players have guessed
    useEffect(() => {
        if (gameStatus.isGameActive && gameStatus.selectedWord) {
            const nonDrawerCount = participants.length - 1; // Exclude the drawer
            const allPlayersGuessed = gameStatus.guessedPlayers.length === nonDrawerCount;

            if (allPlayersGuessed && !isProcessing.current) {
                // Set timer to 0 to trigger game advancement
                updateGameStatus(prev => ({
                    ...prev,
                    timeRemaining: 0
                }));
                advanceGame('all_guessed');
            }
        }
    }, [gameStatus.guessedPlayers, participants.length, gameStatus.isGameActive, gameStatus.selectedWord, advanceGame, updateGameStatus]);

    // Timer effect
    useEffect(() => {
        let timer;

        const updateTimer = async () => {
            if (!gameStatus.isGameActive || isProcessing.current) return;

            let needsWordSelection = false;
            let wordToSelect = null;

            await updateGameStatus(prev => {
                if (!prev.isGameActive) return prev;

                // Handle word selection countdown
                if (prev.wordSelectionTime > 0) {
                    needsWordSelection = (
                        prev.wordSelectionTime === 1 &&
                        !prev.selectedWord &&
                        prev.currentDrawer === currentUser.id &&
                        prev.availableWords?.length > 0
                    );

                    if (needsWordSelection) {
                        wordToSelect = prev.availableWords[0];
                    }

                    return {
                        ...prev,
                        wordSelectionTime: prev.wordSelectionTime - 1
                    };
                }

                // Handle drawing countdown
                if (prev.timeRemaining > 0) {
                    // Handle hints
                    if (prev.nextHintTime === prev.timeRemaining) {
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
                                timeRemaining: prev.timeRemaining - 1
                            };
                        }
                    }
                    return {
                        ...prev,
                        timeRemaining: prev.timeRemaining - 1
                    };
                }

                // Handle time expiration
                if (prev.timeRemaining === 0 && !isProcessing.current) {
                    setTimeout(() => advanceGame('time_expired'), 0);
                }

                return prev;
            });

            if (needsWordSelection && wordToSelect) {
                await selectWord(wordToSelect);
            }
        };

        if (gameStatus.isGameActive) {
            timer = setInterval(updateTimer, 1000);
        }

        return () => {
            if (timer) clearInterval(timer);
        };
    }, [
        gameStatus.isGameActive,
        currentUser?.id,
        selectWord,
        advanceGame,
        updateGameStatus,
        gameSettings.drawTime,
        gameSettings.hints
    ]);

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

            const firstDrawer = participants[0];
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

            isProcessing.current = false;
            await updateGameStatus(initialGameStatus);

            const messagesRef = collection(db, "rooms", roomId, "messages");
            await addDoc(messagesRef, {
                text: `Game is starting! First round begins. ${firstDrawer.name} is now choosing a word to draw!`,
                sender: { id: "system", name: "System" },
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error starting game:", error);
            isProcessing.current = false;
        }
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

    // Rest of the JSX remains the same as in your original component
    return (
        <div className="game-round-status">
            {gameStatus.isGameActive && (
                <div>
                    <h2>Round {gameStatus.currentRound} of {gameSettings.rounds}</h2>
                    <p>Current Drawer: {participants.find(p => p.id === gameStatus.currentDrawer)?.name}</p>

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

                    {gameStatus.wordSelectionTime === 0 && (
                        <div>
                            {currentUser?.id === gameStatus.currentDrawer ? (
                                <h3>You are drawing: {gameStatus.selectedWord}</h3>
                            ) : (
                                <div>
                                    <h3>Word to guess: {getMaskedWord(gameStatus.selectedWord, gameStatus.revealedHints)}</h3>
                                    <p>Hints remaining: {Math.max(0, (gameSettings.hints || 0) - (gameStatus.revealedHints?.length || 0))}</p>
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