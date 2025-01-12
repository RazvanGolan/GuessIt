# GuessIt

GuessIt is a fun and interactive multiplayer guessing game built with React and powered by Firebase for authentication, hosting, and database management. Players can log in, join or host games, and compete to guess the correct word based on another player's drawing. 


## Features

### Authentication
- Login with Email/Password.
- Option to play as a guest.

### Game Management
- **Join/Host Game:** Easily join or host a new game session.
- **Invite Players:** Share an invite link or QR code to get friends to join.

### Communication
- In-game chat to interact with other players and submit guesses.

### Gameplay Mechanics
- Each round ends when every player has taken a turn drawing.
- The drawing player selects one word from three random options and illustrates it.
- Players guess the word by sending messages in the chat.
- Points are awarded for correct guesses:
  - Bonus points for faster guesses.
- A final scoreboard announces the winner after all rounds.

## Installation and Setup Locally

### Prerequisites
Ensure you have the following installed on your machine:
- [Node.js](https://nodejs.org/) (version 14 or later)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Steps
1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/GuessIt.git
   ```
2. Navigate to the project directory:
   ```bash
   cd GuessIt
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Configure Firebase:
   - Create a Firebase project at [Firebase Console](https://console.firebase.google.com/).
   - Enable Email/Password Authentication and set up a Realtime Database.
   - Copy your Firebase configuration settings and update the `.env` file in the project.
   ```env
   REACT_APP_FIREBASE_API_KEY=your_api_key
   REACT_APP_FIREBASE_AUTH_DOMAIN=your_auth_domain
   REACT_APP_FIREBASE_PROJECT_ID=your_project_id
   REACT_APP_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
   REACT_APP_FIREBASE_APP_ID=your_app_id
   ```
5. Start the development server:
   ```bash
   npm start
   ```
6. Open your browser and navigate to `http://localhost:3000` to play!

## Usage

1. **Login:** Log in using your email and password, or choose to play as a guest.
2. **Join or Host a Game:**
   - To host a game, click on "Host Game" and share the invite link or QR code with friends.
   - To join a game, click "Join Game" and enter the invite code.
3. **Gameplay:**
   - The host starts the game, and players take turns drawing and guessing.
   - Points are awarded for correct guesses, and bonus points are given for faster responses.
   - Chat with other players to submit guesses or have fun discussions.
4. **End of Game:**
   - After all rounds, view the final scoreboard to see the winner!

## Technologies Used
- **Frontend:** React, React Router
- **Backend:** Firebase Authentication, Firebase Realtime Database
- **Styling:** CSS Modules
- **Other Tools:** QR Code Generator

## License
This project is licensed under the [MIT License](LICENSE).
