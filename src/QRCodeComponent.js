import { QRCodeSVG } from "qrcode.react";
import React, { useState } from "react";
import './QRCodeComponent.css'; // Import the CSS file

function QRCodeComponent() {
    const [showQRCode, setShowQRCode] = useState(false);

    const QRCodeModal = () => {
        const currentUrl = window.location.href;

        return (
            <div className="qr-code-modal-backdrop">
                <div className="qr-code-modal-content">
                    <button
                        onClick={() => setShowQRCode(false)}
                        className="qr-code-modal-close-btn"
                    >
                        Close
                    </button>
                    <h3>Scan to Join Room</h3>
                    <QRCodeSVG
                        value={currentUrl}
                        size={256}
                        level={'H'}
                    />
                    <p>Scan this QR code to join the room</p>
                </div>
            </div>
        );
    };

    return (
        <div>
            <button onClick={() => setShowQRCode(true)} className="qr-code-btn">
                QR Code
            </button>

            {/* QR Code Modal */}
            {showQRCode && <QRCodeModal />}
        </div>
    );
}

export default QRCodeComponent;
