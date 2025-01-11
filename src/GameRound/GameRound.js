import React, {useState, useEffect, useRef, useCallback} from 'react';
import {doc, collection, addDoc, getDoc} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { TransitionGroup, CSSTransition } from 'react-transition-group';

const GameRound = ({ roomId, participants, gameSettings, currentUser, isRoomOwner, gameStatus, updateGameStatus, removeParticipant }) => {
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
                drawingData: [],
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
    const styles = {
        container: {
            backgroundColor: "#F5F0CD",
            padding: "25px",
            borderRadius: "12px",
            boxShadow: "0 8px 16px rgba(0, 0, 0, 0.1)",
            fontFamily: "Arial, sans-serif",
            maxWidth: "800px",
            margin: "0 10 auto",
        },
        title: {
            fontSize: "2rem",
            fontWeight: "bold",
            marginBottom: "20px",
            color: "#2C3E50",
            textAlign: "center",
        },
        section: {
            backgroundColor: "rgba(255, 255, 255, 0.7)",
            padding: "20px",
            borderRadius: "10px",
            marginBottom: "20px",
            boxShadow: "0 4px 8px rgba(0, 0, 0, 0.05)",
            transition: "transform 0.2s",
        },
        button: {
            backgroundColor: "#FADA7A",
            border: "none",
            borderRadius: "8px",
            padding: "12px 20px",
            cursor: "pointer",
            fontWeight: "bold",
            color: "#333",
            marginRight: "10px",
            marginBottom: "10px",
            boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
            transition: "transform 0.2s, box-shadow 0.2s",
            ":hover": {
                transform: "translateY(-2px)",
                boxShadow: "0 4px 8px rgba(0, 0, 0, 0.15)",
            }
        },
        listItem: {
            listStyleType: "none",
            marginBottom: "10px",
            padding: "8px",
            borderRadius: "6px",
            backgroundColor: "rgba(255, 255, 255, 0.5)",
            justifyContent: "space-between",
            alignItems: "center",
        },
        listContainer: {
            padding: "0",
            margin: "0",
        },
        lineThrough: {
            textDecoration: "line-through",
            opacity: "0.7",
        },
        bold: {
            fontWeight: "bold",
            color: "#2C3E50",
        },
        timeDisplay: {
            fontSize: "1.2rem",
            fontWeight: "bold",
            color: "#E67E22",
            textAlign: "center",
            marginTop: "10px",
        },
        wordDisplay: {
            textAlign: "center",
            fontSize: "1.5rem",
            margin: "15px 0",
            padding: "15px",
            backgroundColor: "white",
            borderRadius: "8px",
            boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)",
        },
        scoreboardTitle: {
            textAlign: "center",
            color: "#2C3E50",
            marginBottom: "15px",
        },
        scoreItem: {
            display: "flex",
            justifyContent: "space-between",
            padding: "0px 25px",
            backgroundColor: "rgba(255, 255, 255, 0.4)",
            borderRadius: "6px",
            transition: "all 0.5s ease",
            margin:"10px 0",
        },
        scoreValue: {
            transition: "transform 0.3s ease",
        },
        scoreAnimated: {
            transform: "scale(1.2)",
            backgroundColor: "#FADA7A",
        }

    };

        return (
            <div style={styles.container}>

                {!gameStatus.isGameActive && (
                    <div style={styles.section}>
                        <h3>Participants</h3>
                        <ul style={styles.listContainer}>
                            {participants.map((p) => (
                                <li key={p.id} style={{
                                    ...styles.listItem,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}>
                                    <span style={{flex: 1, textAlign: "center"}}>
                                        {p.name} {p.isOwner ? "👑" : ""}
                                    </span>
                                    
                                    {isRoomOwner && !p.isOwner && (
                                        <button
                                            onClick={() => removeParticipant(p.id)}
                                            style={{
                                                backgroundColor: '#3498db',  // Theme blue color
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '6px',
                                                padding: '6px 12px',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                fontWeight: '500',
                                                transition: 'all 0.3s ease',
                                                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                                                position: 'relative',
                                                overflow: 'hidden',
                                                transform: 'translateY(0)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = '#2980b9';
                                                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
                                                e.currentTarget.style.transform = 'translateY(-1px)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = '#3498db';
                                                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                                                e.currentTarget.style.transform = 'translateY(0)';
                                            }}
                                        >
                                            <svg  // Add an icon
                                                width="14"
                                                height="14"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                            </svg>
                                            Remove
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {gameStatus.isGameActive && (
                    <div>
                        <h2 style={styles.title}>
                            Round {gameStatus.currentRound} of {gameSettings.rounds}
                        </h2>
                        <p>
                            Current Drawer:{" "}
                            {participants.find((p) => p.id === gameStatus.currentDrawer)?.name}
                        </p>

                        {currentUser?.id === gameStatus.currentDrawer &&
                            gameStatus.wordSelectionTime > 0 && (
                                <div style={styles.section}>
                                    <h3>
                                        Choose a word to draw! ({gameStatus.wordSelectionTime} seconds
                                        left)
                                    </h3>
                                    <div>
                                        {gameStatus.availableWords.map((word, index) => (
                                            <button
                                                key={index}
                                                style={styles.button}
                                                onClick={() => selectWord(word)}
                                            >
                                                {word}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                        {gameStatus.wordSelectionTime === 0 && (
                            <div style={styles.section}>
                                {currentUser?.id === gameStatus.currentDrawer ? (
                                    <h3>You are drawing: {gameStatus.selectedWord}</h3>
                                ) : (
                                    <div>
                                        <h3>
                                            Word to guess:{" "}
                                            {getMaskedWord(
                                                gameStatus.selectedWord,
                                                gameStatus.revealedHints
                                            )}
                                        </h3>
                                        <p>
                                            Hints remaining:{" "}
                                            {Math.max(
                                                0,
                                                (gameSettings.hints || 0) -
                                                (gameStatus.revealedHints?.length || 0)
                                            )}
                                        </p>
                                    </div>
                                )}
                                <p>Time Remaining: {gameStatus.timeRemaining} seconds</p>
                            </div>
                        )}

                        <div style={styles.section}>
                            <h4>Drawing Order:</h4>
                            <ul>
                                {participants.map((p) => (
                                    <li
                                        key={p.id}
                                        style={{
                                            ...styles.listItem,
                                            ...(gameStatus.completedDrawers.includes(p.id)
                                                ? styles.lineThrough
                                                : {}),
                                            ...(p.id === gameStatus.currentDrawer ? styles.bold : {}),
                                        }}
                                    >
                                        {p.name}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div style={styles.section}>
                            <h3 style={styles.scoreboardTitle}>Scoreboard</h3>
                            <TransitionGroup component="ul" style={styles.listContainer}>
                                {[...participants]
                                    .sort((a, b) => (gameStatus.playerScores[b.id] || 0) - (gameStatus.playerScores[a.id] || 0))
                                    .map((p, index) => (
                                        <CSSTransition
                                            key={p.id}
                                            timeout={500}
                                            classNames="score-item"
                                        >
                                            <li
                                                style={{
                                                    ...styles.scoreItem,
                                                    transform: `translateY(${index * 100}%)`
                                                }}
                                            >
                                                <span>{p.name}</span>
                                                <span>{gameStatus.playerScores[p.id] || 0} points</span>
                                            </li>
                                        </CSSTransition>
                                    ))}
                            </TransitionGroup>
                        </div>

                        <style jsx>{`
                            .score-item-enter {
                                opacity: 0;
                                transform: translateY(-20px);
                            }

                            .score-item-enter-active {
                                opacity: 1;
                                transform: translateY(0);
                                transition: all 500ms ease;
                            }

                            .score-item-exit {
                                opacity: 1;
                            }

                            .score-item-exit-active {
                                opacity: 0;
                                transform: translateY(20px);
                                transition: all 500ms ease;
                            }
                        `}</style>


                    </div>
                )}

                {isRoomOwner && !gameStatus.isGameActive && (
                    <button style={styles.button} onClick={startGame}>
                        Start Game
                    </button>
                )}

            </div>
        );
};

export default GameRound;