import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { db } from "../firebaseConfig";
import { setDoc, getDoc, doc, updateDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, setPersistence, updateProfile, browserLocalPersistence} from "firebase/auth";
import './MainPage.css';

const auth = getAuth();

function MainPage() {
    const [roomId, setRoomId] = useState("");
    const [isGuest, setIsGuest] = useState(false);
    const [user, setUser] = useState(null); // Authenticated user or guest
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [guestName, setGuestName] = useState(""); // Track guest name
    const [isNameInputVisible, setIsNameInputVisible] = useState(false);
    const [isGuestNameInputVisible, setIsGuestNameInputVisible] = useState(false);
    const [isInputVisible, setIsInputVisible] = useState(false);

    const navigate = useNavigate();
    const location = useLocation();

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

                // Set the display name for the newly created user
                await updateProfile(userCredential.user, {
                    displayName: name,
                });
            } else {
                userCredential = await signInWithEmailAndPassword(auth, email, password);
            }

            const firebaseUser = userCredential.user;

            const userData = {
                id: firebaseUser.uid,
                name: firebaseUser.displayName || name, // Use display name if available
                email: firebaseUser.email,
                isGuest: false,
            };

            setUser(userData);
            await saveUserData(userData);
            console.log("User logged in:", userData);
        } catch (error) {
            console.error("Error with authentication:", error);

            // Map Firebase error codes to user-friendly messages
            let errorMessage;
            switch (error.code) {
                case "auth/email-already-in-use":
                    errorMessage = "The email address is already in use by another account.";
                    break;
                case "auth/invalid-email":
                    errorMessage = "The email address is not valid.";
                    break;
                case "auth/weak-password":
                    errorMessage = "Password should be at least 6 characters.";
                    break;
                case "auth/user-not-found":
                    errorMessage = "No user found with this email.";
                    break;
                case "auth/invalid-credential":
                    errorMessage = "The credentials provided are invalid. Please check your email and password.";
                    break;
                default:
                    errorMessage = "An unexpected error occurred. Please try again.";
            }

            // Show an alert to the user
            alert(errorMessage);
        }
    };


    // Function to log in as a guest
    const handleGuest = () => {
        setIsGuestNameInputVisible(true);
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
                const existingUserData = userSnap.data();
                setUser(existingUserData);
                setIsGuest(true);
                setIsGuestNameInputVisible(false);
                localStorage.setItem("guestUser", JSON.stringify(existingUserData));

                // If there's a room ID, attempt to join the room
                if (roomId) {
                    await handleRoomJoinAfterAuth(existingUserData, roomId);
                }
            } else {
                await setDoc(userRef, guestData);
                setUser(guestData);
                setIsGuest(true);
                setIsGuestNameInputVisible(false);
                localStorage.setItem("guestUser", JSON.stringify(guestData));

                // If there's a room ID, attempt to join the room
                if (roomId) {
                    await handleRoomJoinAfterAuth(guestData, roomId);
                }
            }
        } catch (error) {
            console.error("Error saving guest data:", error);
        }
    };

    // Check for authenticated user or guest on page load
    useEffect(() => {
        // Check for room ID in URL query parameters
        const searchParams = new URLSearchParams(location.search);
        const inviteRoomId = searchParams.get('roomId');

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

                // If there's an invite room ID, try to join the room
                if (inviteRoomId) {
                    handleRoomJoinAfterAuth(userData, inviteRoomId);
                }
            }
        });

        // Check for guest user in localStorage
        const storedGuest = localStorage.getItem("guestUser");
        if (storedGuest) {
            const guestData = JSON.parse(storedGuest);
            setUser(guestData);
            setIsGuest(true);

            // If there's an invite room ID, try to join the room
            if (inviteRoomId) {
                handleRoomJoinAfterAuth(guestData, inviteRoomId);
            }
        }

        // Set roomId if invite link is present
        if (inviteRoomId) {
            setRoomId(inviteRoomId);
        }

        return () => unsubscribe(); // Cleanup on unmount
    }, [location]);

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
                ownerName: user.name, // Add owner ID
                participants: [
                    {
                        id: user.id,
                        name: user.name,
                        isGuest,
                        isOwner: true, // Mark the creator as owner
                    },
                ],
                gameSettings: {
                    maxPlayers: 4,
                    drawTime: 90,
                    rounds: 3,
                    wordCount: 3,
                    hints: 2,
                    customWords: ''
                }
            });

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

                // Check if game is currently active
                if (roomData.gameStatus?.isGameActive) {
                    alert("Game is currently in progress. Cannot join right now.");
                    navigate("/");
                    return;
                }

                // Check if room has reached max players
                const maxPlayers = roomData.gameSettings?.maxPlayers || 4;
                if (roomData.participants.length >= maxPlayers) {
                    alert("Room is full. Cannot join.");
                    navigate("/");
                    return;
                }

                await updateDoc(roomRef, {
                    participants: [
                        ...roomData.participants,
                        { id: user.id, name: user.name, isGuest, isOwner: false },
                    ],
                });

                navigate(`/room/${roomId}`);
            } else {
                alert("Room not found");
            }
        } catch (error) {
            console.error("Error joining room:", error);
        }
    };

    const handleRoomJoinAfterAuth = async (user, roomId) => {
        try {
            const roomRef = doc(db, "rooms", roomId);
            const roomSnap = await getDoc(roomRef);

            if (roomSnap.exists()) {
                const roomData = roomSnap.data();

                // Check if game is currently active
                if (roomData.gameStatus?.isGameActive) {
                    alert("Game is currently in progress. Cannot join right now.");
                    navigate("/");
                    return;
                }

                // Check if room has reached max players
                const maxPlayers = roomData.gameSettings?.maxPlayers || 4;
                if (roomData.participants.length >= maxPlayers) {
                    alert("Room is full. Cannot join.");
                    navigate("/");
                    return;
                }

                // Check if user is already in the room
                const isAlreadyInRoom = roomData.participants.some(
                    participant => participant.id === user.id
                );

                if (!isAlreadyInRoom) {
                    // Add user to the room
                    await updateDoc(roomRef, {
                        participants: [
                            ...roomData.participants,
                            {
                                id: user.id,
                                name: user.name,
                                isGuest: user.isGuest || false
                            }
                        ]
                    });
                }

                // Navigate to the room
                navigate(`/room/${roomId}`);
            } else {
                alert("Room not found");
                navigate("/");
            }
        } catch (error) {
            console.error("Error joining room:", error);
            alert("Failed to join room");
            navigate("/");
        }
    };

    return (
        <div className="bigContainer">
            <div className="title">
                <h1 unselectable="on">Guess It</h1>
            </div>
            <p unselectable="on">A free online multiplayer drawing and guessing game</p>

            <div className="authentication">
                {!user && (
                    <div>
                        <div className="singInUpContainer">
                            <div className="formInputs">
                                {isNameInputVisible && (
                                    <input
                                        type="text"
                                        placeholder="Name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                    />
                                )}
                                <input
                                    type="email"
                                    placeholder="Email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                                <input
                                    type="password"
                                    placeholder="Password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                            <div className="formButtons">
                                <button className="colorfulButtons" onClick={() => handleAuth(false)}>Login</button>
                                <button className="colorfulButtons" onClick={() => { !isNameInputVisible ? setIsNameInputVisible(true) : handleAuth(true)}}>Sign Up</button>
                            </div>
                        </div>
                        <button  className="colorfulButtons" onClick={handleGuest} style={{width:170, margin: 20}}>
                            Continue as Guest
                        </button>
                    </div>
                )}

                {isGuestNameInputVisible && !user && (
                    <div className="guestAuthentication">
                        <h3>Please enter a name:</h3>
                        <div>
                            <input
                                type="text"
                                placeholder="Guest Name"
                                value={guestName}
                                onChange={(e) => setGuestName(e.target.value)}
                            />
                        </div>
                        <div>
                            <button className="colorfulButtons" onClick={handleGuestNameSubmit}>Submit</button>
                        </div>
                    </div>
                )}
            </div>

            {user && (
                <div className="hostJoinGame">
                    <div className="hostJoinButtons">
                    <button style={{ marginRight: "50px" }} className="colorfulButtons" onClick={hostGame}>Host Game</button>
                        <button
                            onClick={() => setIsInputVisible(true)}
                            disabled={isInputVisible}
                            className="colorfulButtons"
                        >
                            Join Game
                        </button>
                    </div>
                    {isInputVisible && (
                        <div className="enterRoomContainer">
                            <input
                                type="text"
                                placeholder="Enter room code..."
                                value={roomId}
                                onChange={(e) => setRoomId(e.target.value)}
                                style={{ border:0 }}
                            />
                            <button onClick={joinGame} style={{ padding:0, border:0 }}><img width="35" height="35"  src="https://img.icons8.com/ios-filled/50/search--v1.png"  alt="search--v1"/></button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default MainPage;
