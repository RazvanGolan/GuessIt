import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "./firebaseConfig";
import { updateDoc, setDoc, getDoc ,doc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";

const auth = getAuth();

function MainPage() {
    const [roomId, setRoomId] = useState("");
    const [isGuest, setIsGuest] = useState(false);
    const [user, setUser] = useState(null); // Authenticated user or guest
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [guestName, setGuestName] = useState(""); // Track guest name
    const [isNameInputVisible, setIsNameInputVisible] = useState(false); // Show guest name input

    const navigate = useNavigate();

    // Save user or guest data to Firestore
    const saveUserData = async (userData) => {
        try {
            await setDoc(doc(db, "users", userData.id), {
                id: userData.id,
                name: userData.name,
                email: userData.email || null, // Email is null for guests
                isGuest: !!userData.isGuest,
            });
        } catch (error) {
            console.error("Error saving user data:", error);
        }
    };

    // Function to handle login/signup
    const handleAuth = async (isSignup) => {
        try {
            let userCredential;
            if (isSignup) {
                userCredential = await createUserWithEmailAndPassword(auth, email, password);
            } else {
                userCredential = await signInWithEmailAndPassword(auth, email, password);
            }
            const firebaseUser = userCredential.user;

            const userData = {
                id: firebaseUser.uid,
                name,
                email,
                isGuest: false,
            };

            setUser(userData);
            await saveUserData(userData);
            console.log("User logged in:", userData);
        } catch (error) {
            console.error("Error with authentication:", error);
        }
    };

    // Function to log in as a guest
    const handleGuest = () => {
        // Show the guest name input form
        setIsNameInputVisible(true);
    };

    // Save guest data after name input
    const handleGuestNameSubmit = async () => {
        if (!guestName) {
            alert("Please enter a name for the guest.");
            return;
        }

        const guestId = `guest-${guestName.toLowerCase()}`; // Generate a unique guest ID
        const guestData = { id: guestId, name: guestName, isGuest: true };

        // Save guest data to Firestore in the users collection with a guest ID
        try {
            const userRef = doc(db, "users", guestId); // Save under users/{guestId}
            await setDoc(userRef, guestData); // Create the document with the guest data
            setUser(guestData); // Update the user state
            setIsGuest(true); // Set guest state
            setIsNameInputVisible(false); // Hide name input after submission
        } catch (error) {
            console.error("Error saving guest data:", error);
        }
    };


    // Function to create a room
    const hostGame = async () => {
        if (!user) {
            alert("You must log in or continue as guest first.");
            return;
        }

        try {
            const shortId = Math.floor(10000 + Math.random() * 90000).toString();

            // Use setDoc to set the document ID explicitly to the shortId
            const roomRef = doc(db, "rooms", shortId); // Create a reference to the room with the custom ID
            await setDoc(roomRef, {
                roomId: shortId, // Store the roomId as a field
                participants: [
                    {
                        id: user.id,
                        name: user.name,
                        isGuest,
                    },
                ],
            });

            console.log("Room created with ID:", shortId);
            navigate(`/room/${shortId}`); // Redirect to the new room URL with the custom ID
        } catch (error) {
            console.error("Error creating room:", error);
        }
    };

    // Function to join a room
    const joinGame = async () => {
        if (!user) {
            alert("You must log in or continue as guest first.");
            return;
        }

        try {
            const roomRef = doc(db, "rooms", roomId);
            const roomSnap = await getDoc(roomRef);

            if (roomSnap.exists()) {
                const roomData = roomSnap.data();
                await updateDoc(roomRef, {
                    participants: [
                        ...roomData.participants,
                        { id: user.id, name: user.name, isGuest },
                    ],
                });

                console.log("Joined room:", roomId);
                navigate(`/room/${roomId}`);
            } else {
                alert("Room not found");
            }
        } catch (error) {
            console.error("Error joining room:", error);
        }
    };

    return (
        <div style={{ textAlign: "center", marginTop: "50px" }}>
            <h1>Welcome to Guess It!</h1>

            {!user && (
                <>
                    <div>
                        <input type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
                        <button onClick={() => handleAuth(false)}>Login</button>
                        <button onClick={() => handleAuth(true)}>Sign Up</button>
                    </div>
                    <button onClick={handleGuest}>Continue as Guest</button>
                </>
            )}

            {isNameInputVisible && !user && (
                <>
                    <h3>Please enter a name for the guest:</h3>
                    <input
                        type="text"
                        placeholder="Guest Name"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                    />
                    <button onClick={handleGuestNameSubmit}>Submit</button>
                </>
            )}

            {user && (
                <>
                    <button onClick={hostGame}>Host Game</button>
                    <div style={{ marginTop: "20px" }}>
                        <input
                            type="text"
                            placeholder="Enter Room ID"
                            value={roomId}
                            onChange={(e) => setRoomId(e.target.value)}
                        />
                        <button onClick={joinGame}>Join Game</button>
                    </div>
                </>
            )}
        </div>
    );
}

export default MainPage;
