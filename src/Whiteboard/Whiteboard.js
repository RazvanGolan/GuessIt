import React, { useRef, useEffect, useState, useCallback } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './Whiteboard.css'

const Whiteboard = ({
                        roomId = '',
                        currentDrawer = null,
                        currentUser = {},
                        guessedPlayers = [],
                        participants = []
                    }) => {
    const canvasRef = useRef(null);
    const contextRef = useRef(null);
    const isDrawing = useRef(false);
    const lastPoint = useRef(null);
    const [color, setColor] = useState('#000000');
    const [brushSize, setBrushSize] = useState(5);
    const [drawingData, setDrawingData] = useState([]);
    const lastBatchRef = useRef([]);
    const batchTimerRef = useRef(null);

    useEffect(() => {
        if (guessedPlayers.length > 0 && participants.length > 1) {
            const nonDrawerCount = participants.length - 1;
            if (guessedPlayers.length === nonDrawerCount) {
                clearCanvas();
            }
        }
    }, [guessedPlayers, participants]);


useEffect(() => {
        const canvas = canvasRef.current;
        canvas.width = 800;
        canvas.height = 600;

        const context = canvas.getContext('2d');
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.strokeStyle = color;
        context.lineWidth = brushSize;
        contextRef.current = context;

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        const roomRef = doc(db, 'rooms', roomId);
        const unsubscribe = onSnapshot(roomRef, (snapshot) => {
            const data = snapshot.data();
            if (data?.drawingData?.length > 0) {
                setDrawingData(data.drawingData);
                redrawCanvas(data.drawingData);
            }
        });


        return () => {
            unsubscribe();
            if (batchTimerRef.current) {
                clearTimeout(batchTimerRef.current);
            }
        };
    }, [roomId]);



    const updateDrawingInFirestore = useCallback((newActions) => {
        lastBatchRef.current = [...lastBatchRef.current, ...newActions];

        if (batchTimerRef.current) {
            clearTimeout(batchTimerRef.current);
        }

        batchTimerRef.current = setTimeout(async () => {
            try {
                const roomRef = doc(db, 'rooms', roomId);
                await updateDoc(roomRef, {
                    drawingData: [...drawingData, ...lastBatchRef.current]
                });
                lastBatchRef.current = [];
            } catch (error) {
                console.error('Error updating drawing:', error);
            }
        }, 100);
    }, [drawingData, roomId]);

    const drawLine = useCallback((start, end, strokeColor, strokeWidth, emit = true) => {
        const context = contextRef.current;
        if (!context) return;

        context.beginPath();
        context.strokeStyle = strokeColor;
        context.lineWidth = strokeWidth;
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();

        if (emit) {
            const newAction = {
                type: 'line',
                start: { x: start.x, y: start.y },
                end: { x: end.x, y: end.y },
                color: strokeColor,
                brushSize: strokeWidth
            };
            updateDrawingInFirestore([newAction]);
        }
    }, [updateDrawingInFirestore]);

    const startDrawing = useCallback(({ nativeEvent }) => {
        if (currentUser.id !== currentDrawer) return;

        const { offsetX, offsetY } = nativeEvent;
        isDrawing.current = true;
        lastPoint.current = { x: offsetX, y: offsetY };
    }, [currentUser.id, currentDrawer]);

    const stopDrawing = useCallback(() => {
        isDrawing.current = false;
        lastPoint.current = null;
    }, []);

    const draw = useCallback(({ nativeEvent }) => {
        if (!isDrawing.current || currentUser.id !== currentDrawer || !lastPoint.current) return;

        const { offsetX, offsetY } = nativeEvent;
        const currentPoint = { x: offsetX, y: offsetY };

        // Calculate distance between points
        const distance = Math.sqrt(
            Math.pow(currentPoint.x - lastPoint.current.x, 2) +
            Math.pow(currentPoint.y - lastPoint.current.y, 2)
        );

        // If distance is too large, interpolate points for smoother lines
        if (distance > 2) {
            const steps = Math.floor(distance / 2);
            for (let i = 1; i <= steps; i++) {
                const x = lastPoint.current.x + (currentPoint.x - lastPoint.current.x) * (i / steps);
                const y = lastPoint.current.y + (currentPoint.y - lastPoint.current.y) * (i / steps);
                const intermediatePoint = { x, y };

                drawLine(lastPoint.current, intermediatePoint, color, brushSize);
                lastPoint.current = intermediatePoint;
            }
        }

        drawLine(lastPoint.current, currentPoint, color, brushSize);
        lastPoint.current = currentPoint;
    }, [currentUser.id, currentDrawer, color, brushSize, drawLine]);

    const redrawCanvas = useCallback((data) => {
        const context = contextRef.current;
        if (!context) return;

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);

        data.forEach(action => {
            if (action.type === 'clear') {
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            } else if (action.type === 'line' && action.start && action.end) {
                drawLine(action.start, action.end, action.color, action.brushSize, false);
            }
        });
    }, [drawLine]);

    const clearCanvas = useCallback(async () => {
        if (currentUser.id !== currentDrawer) return;

        const context = contextRef.current;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);

        try {
            const roomRef = doc(db, 'rooms', roomId);
            await updateDoc(roomRef, {
                drawingData: [{ type: 'clear' }]
            });
        } catch (error) {
            console.error('Error clearing canvas:', error);
        }
    }, [currentUser.id, currentDrawer, roomId]);

    return (
        <div className="whiteboard-container">
            <canvas
                ref={canvasRef}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseOut={stopDrawing}
                style={{
                    border: '1px solid #000',
                    cursor: currentUser.id === currentDrawer ? 'crosshair' : 'default',
                    backgroundColor: '#ffffff'
                }}
            />

            {currentUser.id === currentDrawer && (
                <div className="drawing-controls">
                    <div className="color-picker">
                        <label>Color:</label>
                        <input
                            type="color"
                            value={color}
                            onChange={(e) => setColor(e.target.value)}
                        />
                    </div>
                    <div className="brush-size">
                        <label>Brush Size: {brushSize}px</label>
                        <input
                            type="range"
                            min="1"
                            max="20"
                            value={brushSize}
                            onChange={(e) => setBrushSize(parseInt(e.target.value))}
                        />
                    </div>
                    <button
                        onClick={clearCanvas}
                        className="colorfullButton"
                    >
                        Clear Canvas
                    </button>
                </div>
            )}
        </div>
    );
};

export default Whiteboard;