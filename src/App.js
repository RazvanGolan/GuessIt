import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import MainPage from "./MainPage/MainPage";
import GameRoom from "./GameRoom/GameRoom";

function App() {
  return (
      <Router>
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/room/:roomId" element={<GameRoom />} />
        </Routes>
      </Router>
  );
}

export default App;
