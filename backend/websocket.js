const WebSocket = require("ws");

const wss = new WebSocket.Server({
    port: 3001
});

wss.on("connection", (socket) => {

    console.log("WebSocket client connected");

    socket.send(JSON.stringify({
        type: "connection",
        message: "WebSocket connected"
    }));

    let progress = 0;

    const testInterval = setInterval(() => {

        progress += 10;

        socket.send(JSON.stringify({
            type: "test_progress",
            progress: progress
        }));

        if (progress >= 100) {
            clearInterval(testInterval);
        }

    }, 1000);

    socket.on("close", () => {

        clearInterval(testInterval);

        console.log(
            "WebSocket client disconnected"
        );
    });
});

console.log(
    "WebSocket server running on port 3001"
);