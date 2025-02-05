import React, {useState, useEffect, useRef, useCallback} from 'react';
import {doc, collection, addDoc, getDoc} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { TransitionGroup, CSSTransition } from 'react-transition-group';

const GameRound = ({
                       roomId = '',
                       participants = [],
                       gameSettings = {},
                       currentUser = null,
                       isRoomOwner = false,
                       gameStatus = {},
                       updateGameStatus = () => {},
                       removeParticipant = () => {}
                   }) => {
    const isProcessing = useRef(false);
    const [words, setWords] = useState(null);
    const messageDebounceRef = useRef(null);

    const getRandomWords = (wordList, count) => {
        if (!Array.isArray(wordList) || !count) return [];
        const shuffled = [...wordList].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    };

    const calculateHintTimes = (drawTime, numHints) => {
        if (!drawTime || !numHints) return [];
        const interval = Math.floor(drawTime / (numHints + 1));
        return Array.from({ length: numHints }, (_, i) => drawTime - interval * (i + 1));
    };

    const getRandomUnrevealedPosition = (word, revealedPositions) => {
        if (!word || !Array.isArray(revealedPositions)) return null;
        const availablePositions = Array.from({ length: word.length })
            .map((_, i) => i)
            .filter(pos => !revealedPositions.includes(pos));
        return availablePositions.length > 0
            ? availablePositions[Math.floor(Math.random() * availablePositions.length)]
            : null;
    };

    const addSystemMessage = useCallback(async (message) => {
        if (!roomId || !message) return;

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
        }, 500);
    }, [roomId]);

    const advanceGame = useCallback(async (reason = 'time_expired') => {
        if (!isRoomOwner || isProcessing.current || !gameStatus || !Array.isArray(participants)) return;
        isProcessing.current = true;

        try {
            const updatedCompletedDrawers = [
                ...(gameStatus.completedDrawers || []),
                gameStatus.currentDrawer,
            ].filter(Boolean);

            const roundComplete = updatedCompletedDrawers.length === participants.length;

            let updatedGameStatus;
            let message = '';

            if (roundComplete) {
                const newRound = (gameStatus.currentRound || 0) + 1;

                if (newRound > (gameSettings.rounds || 1)) {
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
                    const firstDrawer = participants[0];
                    const selectedWords = getRandomWords(words, gameSettings.wordCount);

                    updatedGameStatus = {
                        ...gameStatus,
                        currentRound: newRound,
                        currentDrawer: firstDrawer?.id,
                        timeRemaining: gameSettings.drawTime || 60,
                        completedDrawers: [],
                        wordSelectionTime: 10,
                        selectedWord: null,
                        availableWords: selectedWords,
                        guessedPlayers: [],
                        revealedHints: [],
                        nextHintTime: null
                    };
                    message = `Round ${newRound} begins! ${firstDrawer?.name || 'Next player'} is now choosing a word!`;
                }
            } else {
                const remainingDrawers = participants.filter(
                    (p) => !updatedCompletedDrawers.includes(p.id)
                );
                const nextDrawer = remainingDrawers[0];
                const selectedWords = getRandomWords(words, gameSettings.wordCount);

                updatedGameStatus = {
                    ...gameStatus,
                    currentDrawer: nextDrawer?.id,
                    timeRemaining: gameSettings.drawTime || 60,
                    completedDrawers: updatedCompletedDrawers,
                    wordSelectionTime: 10,
                    selectedWord: null,
                    availableWords: selectedWords,
                    guessedPlayers: [],
                    revealedHints: [],
                    nextHintTime: null
                };
                message = `${nextDrawer?.name || 'Next player'} is now choosing a word!`;
            }

            await updateGameStatus(updatedGameStatus);

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
        if (!word || !gameStatus || !currentUser || gameStatus.currentDrawer !== currentUser.id) return;

        try {
            const hintTimes = calculateHintTimes(gameSettings.drawTime, gameSettings.hints);

            const updatedGameStatus = {
                ...gameStatus,
                selectedWord: word,
                wordSelectionTime: 0,
                timeRemaining: gameSettings.drawTime || 60,
                revealedHints: [],
                drawingData: [],
                nextHintTime: hintTimes[0] || null,
                guessedPlayers: []
            };

            await updateGameStatus(updatedGameStatus);

            const messagesRef = collection(db, "rooms", roomId, "messages");
            await addDoc(messagesRef, {
                text: `${currentUser.name || 'Player'} has selected a word to draw!`,
                sender: { id: "system", name: "System" },
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error selecting word:", error);
        }
    }, [currentUser, gameStatus, gameSettings.drawTime, gameSettings.hints, updateGameStatus, roomId]);

    useEffect(() => {
        if (gameStatus?.isGameActive && gameStatus.selectedWord && Array.isArray(participants)) {
            const nonDrawerCount = participants.length - 1;
            const allPlayersGuessed = (gameStatus.guessedPlayers?.length || 0) === nonDrawerCount;

            if (allPlayersGuessed && !isProcessing.current) {
                updateGameStatus(prev => ({
                    ...prev,
                    timeRemaining: 0
                }));
                advanceGame('all_guessed');
            }
        }
    }, [gameStatus?.guessedPlayers, participants?.length, gameStatus?.isGameActive, gameStatus?.selectedWord, advanceGame, updateGameStatus]);

    useEffect(() => {
        let timer;

        const updateTimer = async () => {
            if (!gameStatus?.isGameActive || isProcessing.current) return;

            let needsWordSelection = false;

            await updateGameStatus(prev => {
                if (!prev?.isGameActive) return prev;

                if (prev.wordSelectionTime > 0) {
                    needsWordSelection = (
                        prev.wordSelectionTime === 1 &&
                        !prev.selectedWord &&
                        prev.currentDrawer === currentUser?.id &&
                        Array.isArray(prev.availableWords) &&
                        prev.availableWords.length > 0
                    );

                    if (needsWordSelection) {
                        selectWord(gameStatus.availableWords[0]);
                    }

                    return {
                        ...prev,
                        wordSelectionTime: prev.wordSelectionTime - 1
                    };
                }

                if (prev.timeRemaining > 0) {
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
                                revealedHints: [...(prev.revealedHints || []), newPosition],
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

                if (prev.timeRemaining === 0 && !isProcessing.current) {
                    setTimeout(() => advanceGame('time_expired'), 0);
                }

                return prev;
            });
        };

        if (gameStatus?.isGameActive) {
            timer = setInterval(updateTimer, 1000);
        }

        return () => {
            if (timer) clearInterval(timer);
        };
    }, [gameStatus?.isGameActive, currentUser?.id, advanceGame, updateGameStatus, gameSettings.drawTime, gameSettings.hints, gameStatus?.availableWords, selectWord]);

    const startGame = async () => {
        if (!isRoomOwner || !Array.isArray(participants) || participants.length === 0) return;

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
                currentDrawer: firstDrawer?.id,
                timeRemaining: gameSettings.drawTime || 60,
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
                text: `Game is starting! First round begins. ${firstDrawer?.name || 'First player'} is now choosing a word to draw!`,
                sender: { id: "system", name: "System" },
                timestamp: new Date()
            });
        } catch (error) {
            console.error("Error starting game:", error);
            isProcessing.current = false;
        }
    };

    const getMaskedWord = (word, revealedPositions) => {
        if (!word) return '';
        if (!Array.isArray(revealedPositions)) return '_ '.repeat(word.length).trim();

        return word
            .split('')
            .map((letter, index) => revealedPositions.includes(index) ? letter : '_')
            .join(' ');
    };
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
            padding: "20px 0",
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
        },
        colorfulButtons: {
            "backgroundColor": "#81BFDA",
            "border": "2px solid #FADA7A",  // Made border thicker
            "borderRadius": "12px",         // Increased border radius
            "boxShadow": "rgba(46, 47, 47, 0.3) 0 4px 8px 0, inset 0 1px 2px rgba(255,255,255,0.3)", // Enhanced shadow with inner glow
            "boxSizing": "border-box",
            "color": "rgba(46, 47, 47, 0.8)",
            "cursor": "pointer",
            "padding": "2px 16px",         // Increased padding
            "position": "relative",
            "textDecoration": "none",
            "touchAction": "manipulation",
            "width": "130px",
            "fontSize": "17px",
            "lineHeight": "32px",          // Slightly taller
            "fontWeight": "600",           // Made text bolder
            "transition": "all 0.2s ease", // Smooth transition for hover effects
            "transform": "translateY(0)",   // For hover animation
            ":hover": {
                "backgroundColor": "#669EBA",
                "transform": "translateY(-2px)", // Slight lift effect on hover
                "boxShadow": "rgba(46, 47, 47, 0.4) 0 6px 12px 0, inset 0 1px 2px rgba(255,255,255,0.4)" // Enhanced hover shadow
            },
            ":active": {
                "transform": "translateY(1px)", // Press effect
                "boxShadow": "rgba(46, 47, 47, 0.2) 0 2px 4px 0, inset 0 1px 1px rgba(255,255,255,0.2)"
            }

        },
            participantSection: {
                backgroundColor: "rgba(255, 255, 255, 0.7)",
                padding: "20px",
                borderRadius: "12px",
                marginBottom: "20px",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
                transition: "all 0.3s ease",
            },

            participantList: {
                padding: "0",
                margin: "15px 0",
                listStyle: "none",
            },

            participantItem: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "rgba(255, 255, 255, 0.8)",
                padding: "12px 20px",
                marginBottom: "12px",
                borderRadius: "10px",
                border: "1px solid rgba(129, 191, 218, 0.3)", // Subtle border using your button color
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.05)",
                transition: "all 0.2s ease",
            },

            participantName: {
                flex: 1,
                textAlign: "center",
                fontSize: "16px",
                fontWeight: "500",
                color: "rgba(46, 47, 47, 0.8)", // Matching your button text color
            },

            ownerCrown: {
                marginLeft: "8px",
                fontSize: "18px",
                filter: "drop-shadow(0 2px 2px rgba(0, 0, 0, 0.1))",
            },

            sectionTitle: {
                fontWeight: "600",
                color: "#2C3E50",
                textAlign: "center",
                marginBottom: "20px",
                position: "relative",
                paddingBottom: "10px",
            },




    };

        return (
            <div style={styles.container}>

                {!gameStatus.isGameActive && (
                    <div style={styles.participantSection}>
                        <h3 style={styles.sectionTitle}>
                            Participants
                            <div style={styles.sectionTitleUnderline}></div>
                        </h3>

                        <ul style={styles.participantList}>
                            {participants.map((p) => (
                                <li key={p.id} style={styles.participantItem}>
                        <span style={styles.participantName}>
                            {p.name}
                            {p.isOwner && (
                                <span style={styles.ownerCrown}>👑</span>
                            )}
                        </span>

                                    {isRoomOwner && !p.isOwner && (
                                        <button
                                            onClick={() => removeParticipant(p.id)}
                                            className="colorfulButtons">
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
                    <button onClick={startGame} className="colorfulButtons">
                        Start Game
                    </button>
                )}

            </div>
        );
};

export default GameRound;