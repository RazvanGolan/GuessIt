import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "./firebaseConfig";
import { setDoc, getDoc, doc, updateDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, setPersistence, browserLocalPersistence} from "firebase/auth";

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
            // Set persistence for authentication
            await setPersistence(auth, browserLocalPersistence);

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
        setIsNameInputVisible(true);
    };

    // Save guest data after name input
    const handleGuestNameSubmit = async () => {
        if (!guestName) {
            alert("Please enter a name for the guest.");
            return;
        }

        const guestId = `guest-${guestName.toLowerCase()}`;
        const guestData = { id: guestId, name: guestName, isGuest: true };

        try {
            const userRef = doc(db, "users", guestId);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                // If user already exists, just use the existing user data
                const existingUserData = userSnap.data();
                setUser(existingUserData);
                setIsGuest(true);
                setIsNameInputVisible(false);

                // Update localStorage with existing user
                localStorage.setItem("guestUser", JSON.stringify(existingUserData));
            } else {
                // If user doesn't exist, create new guest user
                await setDoc(userRef, guestData);
                setUser(guestData);
                setIsGuest(true);
                setIsNameInputVisible(false);

                // Save guest data to localStorage for persistence
                localStorage.setItem("guestUser", JSON.stringify(guestData));
            }
        } catch (error) {
            console.error("Error saving guest data:", error);
        }
    };

    // Check for authenticated user or guest on page load
    useEffect(() => {
        // Firebase Auth: Check for authenticated user
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (firebaseUser) {
                const userData = {
                    id: firebaseUser.uid,
                    name: firebaseUser.displayName || "User",
                    email: firebaseUser.email,
                    isGuest: false,
                };
                setUser(userData);
                console.log("Authenticated user restored:", userData);
            }
        });

        // Check for guest user in localStorage
        const storedGuest = localStorage.getItem("guestUser");
        if (storedGuest) {
            const guestData = JSON.parse(storedGuest);
            setUser(guestData);
            setIsGuest(true);
            console.log("Guest user restored:", guestData);
        }

        return () => unsubscribe(); // Cleanup on unmount
    }, []);

    // Function to create a room
    const hostGame = async () => {
        if (!user) {
            alert("You must log in or continue as guest first.");
            return;
        }

        try {
            const shortId = Math.floor(10000 + Math.random() * 90000).toString();
            const roomRef = doc(db, "rooms", shortId);
            await setDoc(roomRef, {
                roomId: shortId,
                participants: [
                    {
                        id: user.id,
                        name: user.name,
                        isGuest,
                    },
                ],
            });

            console.log("Room created with ID:", shortId);
            navigate(`/room/${shortId}`);
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
