import React, { useState, useEffect } from 'react';
import {doc, getDoc, updateDoc} from "firebase/firestore";
import { db } from "../firebaseConfig";
import './GameSettings.css';


const GameSettings = ({ roomId, isRoomOwner, initialSettings }) => {
    const defaultSettings = (initialSettings) => ({
        maxPlayers: initialSettings?.maxPlayers || 4,
        drawTime: initialSettings?.drawTime || 90,
        rounds: initialSettings?.rounds || 3,
        wordCount: initialSettings?.wordCount || 3,
        hints: initialSettings?.hints || 2,
        customWords: initialSettings?.customWords || ''
    });

    const [settings, setSettings] = useState(defaultSettings(initialSettings));
    const [isGameActive, setIsGameActive] = useState(null)

    useEffect(() => {
        setSettings(defaultSettings(initialSettings));
    }, [initialSettings]);

    const updateSettings = async () => {
        if (!isRoomOwner) return;

        try {
            const roomRef = doc(db, "rooms", roomId);
            const roomSnap = await getDoc(roomRef);

            if (roomSnap.exists()) {
                const roomData = roomSnap.data();
                setIsGameActive(roomData.gameStatus?.isGameActive)
            }

            await updateDoc(roomRef, {
                gameSettings: settings
            });
        } catch (error) {
            console.error("Error updating game settings:", error);
        }
    };

    // Update Firestore whenever settings change
    useEffect(() => {
        updateSettings();
    }, [settings, isRoomOwner]);

    // Handler for setting changes
    const handleSettingChange = (field, value) => {
        if (!isRoomOwner) return;
        setSettings(prev => ({
            ...prev,
            [field]: value
        }));
    };

    // Render function for dropdowns based on room owner status
    const renderDropdown = (value, options, onChange) => {
        if (isRoomOwner && !isGameActive) {
            return (
                <select
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                >
                    {options.map(num => (
                        <option key={num} value={num}>{num}</option>
                    ))}
                </select>
            );
        }
        return <span>{value}</span>;
    };

    return (
        <div className="game-settings">
            <h3>Game Configuration</h3>

            {/* Max Players */}
            <div>
                <label>Max Players:</label>
                {renderDropdown(
                    settings.maxPlayers,
                    Array.from({length: 19}, (_, i) => i + 2),
                    (val) => handleSettingChange('maxPlayers', val)
                )}
            </div>

            {/* Draw Time */}
            <div>
                <label>Draw Time (seconds):</label>
                {renderDropdown(
                    settings.drawTime,
                    [10, 30, 45, 60, 75, 90, 120, 150, 180],
                    (val) => handleSettingChange('drawTime', val)
                )}
            </div>

            {/* Rounds */}
            <div>
                <label>Number of Rounds:</label>
                {renderDropdown(
                    settings.rounds,
                    Array.from({length: 9}, (_, i) => i + 2),
                    (val) => handleSettingChange('rounds', val)
                )}
            </div>

            {/* Word Count */}
            <div>
                <label>Word Count:</label>
                {renderDropdown(
                    settings.wordCount,
                    Array.from({length: 5}, (_, i) => i + 2),
                    (val) => handleSettingChange('wordCount', val)
                )}
            </div>

            {/* Hints */}
            <div>
                <label>Number of Hints:</label>
                {renderDropdown(
                    settings.hints,
                    Array.from({length: 6}, (_, i) => i),
                    (val) => handleSettingChange('hints', val)
                )}
            </div>

            {/* Custom Words */}
            <div>
                <label>Custom Words (comma-separated):</label>
                {isRoomOwner ? (
                    <textarea
                        value={settings.customWords}
                        onChange={(e) => handleSettingChange('customWords', e.target.value)}
                        placeholder="Enter custom words, separated by commas"
                        disabled={isGameActive}
                    />
                ) : (
                    <p>{settings.customWords || 'No custom words'}</p>
                )}
            </div>
        </div>
    );
};

export default GameSettings;