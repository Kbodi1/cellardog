const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
    server,
    // Enable WebSocket on cloud platforms
    perMessageDeflate: false,
    clientTracking: true
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Add health check endpoint for cloud hosting
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Store current bracket state
let currentState = {};

// Keep track of connections and handle ping/pong
function heartbeat() {
    this.isAlive = true;
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);
    
    console.log('New client connected');
    
    // Send current state to new client
    if (Object.keys(currentState).length > 0) {
        ws.send(JSON.stringify({
            type: 'fullState',
            state: currentState
        }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'update') {
                currentState = data.state;
                
                // Broadcast to all other clients
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'update',
                            state: currentState
                        }));
                    }
                });
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Handle disconnections and dead connections
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Terminating dead connection');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
}); 