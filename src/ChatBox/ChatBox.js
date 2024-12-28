import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    collection,
    addDoc,
    query,
    orderBy,
    limit,
    onSnapshot, getDoc, doc, updateDoc
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import './ChatBox.css'; // Import the CSS file

function ChatBox({ roomId, currentUser, gameSettings, gameStatus }) {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const messagesEndRef = useRef(null);

    // Fetch messages in real-time
    useEffect(() => {
        if (!roomId) return;

        const messagesRef = collection(db, "rooms", roomId, "messages");
        const messagesQuery = query(
            messagesRef,
            orderBy('timestamp', 'asc'),
            limit(50)
        );

        const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
            const fetchedMessages = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMessages(fetchedMessages);
        });

        return () => unsubscribe();
    }, [roomId]);

    // Scroll to bottom when messages update
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({behavior: "smooth"});
    }, [messages]);

    // Send message handler
    const sendMessage = useCallback(async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !currentUser) return;

        try {
            const messagesRef = collection(db, "rooms", roomId, "messages");
            const roomRef = doc(db, "rooms", roomId);
            const roomDoc = await getDoc(roomRef);

            if (!roomDoc.exists()) return;

            if (
                gameStatus.isGameActive &&
                gameStatus.selectedWord?.toLowerCase() === newMessage.trim().toLowerCase() &&
                !gameStatus.guessedPlayers?.includes(currentUser.id) &&
                gameStatus.currentDrawer !== currentUser.id
            ) {
                // Award points
                const pointsAwarded = Math.ceil(gameStatus.timeRemaining / gameSettings.drawTime * 100); // Example logic
                const updatedScores = { ...gameStatus.playerScores, [currentUser.id]: gameStatus.playerScores[currentUser.id] + pointsAwarded };

                await updateDoc(roomRef, {
                    "gameStatus.guessedPlayers": [...gameStatus.guessedPlayers, currentUser.id],
                    "gameStatus.playerScores": updatedScores
                });

                // Notify guess
                await addDoc(messagesRef, {
                    text: `${currentUser.name} guessed the word! (+${pointsAwarded} points)`,
                    sender: { id: "system", name: "System" },
                    timestamp: new Date()
                });
            }

            // Send message
            if (gameStatus.selectedWord?.toLowerCase() !== newMessage.trim().toLowerCase())
            {
                await addDoc(messagesRef, {
                    text: newMessage,
                    sender: { id: currentUser.id, name: currentUser.name },
                    timestamp: new Date()
                });
            }

            setNewMessage('');
        } catch (error) {
            console.error("Error sending message:", error);
        }
    }, [newMessage, currentUser, roomId, gameSettings]);


    return (
        <div className="chat-container">
            <div className="messages-list">
                {messages.map((message) => (
                    <div
                        key={message.id}
                        className="message"
                    >
                        {/* Check if the message is from the system */}
                        {message.sender.id !== "system" && (
                            <strong>{message.sender.name}:</strong>
                        )}{" "}
                        {message.text}
                    </div>
                ))}
                <div ref={messagesEndRef}/>
                {/* Scroll anchor */}
            </div>
            <form onSubmit={sendMessage} className="message-input-form">
                <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="message-input"
                />
                <button
                    type="submit"
                    className="send-button"
                >
                    Send
                </button>
            </form>
        </div>
    );
}

export default ChatBox;