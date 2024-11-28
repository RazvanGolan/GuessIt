import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebaseConfig";

function GameRoom() {
    const { roomId } = useParams();  // Get the roomId from URL params (this is the document ID in Firestore)
    const [participants, setParticipants] = useState([]);

    useEffect(() => {
        // Run fetchRoomData only if roomId exists
        if (roomId) {
            fetchRoomData();
        }
    }, [roomId]);

    const fetchRoomData = async () => {
        console.log("Fetching room data for room ID (Firestore Document ID):", roomId);  // Log the room ID from URL

        // Query Firestore using the roomId as the document ID (Firestore document ID)
        const roomRef = doc(db, "rooms", roomId);
        console.log("Room reference path:", roomRef.path);  // Log the path to verify the document reference

        const roomSnap = await getDoc(roomRef);  // Fetch the document snapshot

        if (roomSnap.exists()) {
            const roomData = roomSnap.data();  // Get the data from the document
            console.log("Room data found:", roomData);  // Log the data retrieved from Firestore

            // Now we access the roomId property inside the document
            const roomIdFromData = roomData.roomId; // Access the roomId property inside the document

            // Check if the roomId matches (in case you want to do some additional checks)
            if (roomIdFromData.toString() === roomId) {
                setParticipants(roomData.participants);  // Set participants if roomId matches
            } else {
                console.error("Room ID mismatch. Expected:", roomId, "but found:", roomIdFromData);
            }
        } else {
            console.error("Room not found:", roomId);  // Log error if room document is not found
        }
    };

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
        </div>
    );
}

export default GameRoom;
