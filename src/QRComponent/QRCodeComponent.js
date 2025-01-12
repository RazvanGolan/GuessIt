import { QRCodeSVG } from "qrcode.react";
import React, { useState } from "react";
import './QRCodeComponent.css'; // Import the CSS file

function QRCodeComponent({ roomId}) {
    const [showQRCode, setShowQRCode] = useState(false);

    const QRCodeModal = () => {
        const inviteLink = `${window.location.origin}/?roomId=${roomId}`;

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
                        value={inviteLink}
                        size={256}
                        level={'H'}
                        imageSettings={{
                            src: "https://akm-img-a-in.tosshub.com/indiatoday/images/story/202411/chill-guy-memes-have-flooded-social-media-241142207-16x9_0.jpg?VersionId=.osD_GpxkoPy9zvr5i97YYdKPrDZAtG_&size=690:388",
                            excavate: true,
                            height: 100,
                            width: 100
                        }}
                    />
                    <p>Scan this QR code to join the room</p>
                </div>
            </div>
        );
    };

    return (
        <div>
            <button onClick={() => setShowQRCode(true)} className="qr-code-btn colorfulButtons">
                QR Code
            </button>

            {/* QR Code Modal */}
            {showQRCode && <QRCodeModal />}
        </div>
    );
}

export default QRCodeComponent;
