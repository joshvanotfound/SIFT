require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { addReel, getReels } = require("./queue");
const {
    processReel,
    verifyDownloadedFile
} = require("./processor");
const {
    isPublishedMediaPresent
} = require("./instagramUploader");
const app = express();
const PORT = 3000;
const WEBSOCKET_PORT = 3001;
// ========================================
// EXPRESS
// ========================================
app.use(express.json());
// ========================================
// WEBSOCKET SERVER
// ========================================
const wss = new WebSocket.Server({
    port: WEBSOCKET_PORT
});
function broadcast(message) {
    const data =
        JSON.stringify(message);
    wss.clients.forEach(client => {
        if (
            client.readyState ===
            WebSocket.OPEN
        ) {
            client.send(data);
        }
    });
}
wss.on("connection", (socket) => {
    console.log(
        "WebSocket client connected"
    );
    socket.send(
        JSON.stringify({
            type: "connection",
            message: "WebSocket connected"
        })
    );
    socket.on("close", () => {
        console.log(
            "WebSocket client disconnected"
        );
    });
});
console.log(
    `WebSocket server running on port ${WEBSOCKET_PORT}`
);
// ========================================
// URL VALIDATION
// ========================================
function isValidUrl(value) {
    try {
        const url =
            new URL(value);
        return (
            url.protocol === "http:" ||
            url.protocol === "https:"
        );
    } catch {
        return false;
    }
}
// ========================================
// SAVE REELS
// ========================================
function saveReels(reels) {
    const queueFile =
        path.join(
            __dirname,
            "reels.json"
        );
    fs.writeFileSync(
        queueFile,
        JSON.stringify(
            reels,
            null,
            2
        )
    );
}
// ========================================
// MARK INTERRUPTED REELS AS FAILED
// ========================================
//
// If the backend was stopped while a Reel
// was actively being processed, that Reel
// cannot continue from the exact same state.
//
// Instead of leaving it permanently stuck,
// SIFT marks it as Failed when the server
// starts again.
//
// Queued items are intentionally NOT included.
// They can safely resume.
//
function recoverInterruptedReels() {
    const reels =
        getReels();
    let changed =
        false;
    const activeStatuses = [
        "downloading",
        "processing",
        "uploading",
        "publishing",
        "interrupted"
    ];
    for (
        const reel of reels
    ) {
        if (
            !activeStatuses.includes(
                reel.status
            )
        ) {
            continue;
        }
        console.log(
            `Interrupted Reel detected: ${reel.id}`
        );
        console.log(
            `Previous status: ${reel.status}`
        );
        console.log(
            `Previous progress: ${reel.progress}%`
        );
        reel.status =
            "failed";
        reel.stage =
            "Failed";
        reel.progress =
            0;
        reel.detail =
            "Server stopped during processing";
        changed =
            true;
        console.log(
            `Marked Reel as failed: ${reel.id}`
        );
    }
    if (changed) {
        saveReels(
            reels
        );
        console.log(
            "Interrupted Reel recovery completed."
        );
    }
}
// ========================================
// SERVER STATUS
// ========================================
app.get(
    "/api/status",
    (req, res) => {
        res.json({
            status: "online",
            service: "SIFT"
        });
    }
);
// ========================================
// ADD REEL
// ========================================
app.post(
    "/api/reels",
    (req, res) => {
        const { url } =
            req.body;
        if (
            !url ||
            typeof url !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "URL is required"
            });
        }
        const cleanUrl =
            url.trim();
        if (
            !isValidUrl(cleanUrl)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid URL"
            });
        }
        const reel =
            addReel(cleanUrl);
        console.log(
            "Reel added to queue:",
            reel
        );
        processReel(
            reel,
            broadcast
        );
        res.json({
            success: true,
            message: "Reel added to queue",
            reel: reel
        });
    }
);
// ========================================
// GET REELS
// ========================================
app.get(
    "/api/reels",
    (req, res) => {
        res.json(
            getReels()
        );
    }
);
// ========================================
// SERVE REEL VIDEO
// ========================================
app.get(
    "/api/reels/:id/video",
    (req, res) => {
        const reelId =
            req.params.id;
        const filePath =
            path.join(
                __dirname,
                "downloads",
                `${reelId}.mp4`
            );
        if (
            !fs.existsSync(filePath)
        ) {
            return res.status(404).json({
                success: false,
                message: "Video file not found"
            });
        }
        res.sendFile(filePath);
    }
);
// ========================================
// DELETE PC VIDEO
// ========================================
app.delete(
    "/api/reels/:id/file",
    (req, res) => {
        const reelId =
            req.params.id;
        const downloadsDir =
            path.join(
                __dirname,
                "downloads"
            );
        const filePath =
            path.join(
                downloadsDir,
                `${reelId}.mp4`
            );
        if (
            !fs.existsSync(filePath)
        ) {
            return res.status(404).json({
                success: false,
                message: "Video file not found"
            });
        }
        try {
            fs.unlinkSync(
                filePath
            );
            const reels =
                getReels();
            const reel =
                reels.find(
                    item =>
                        item.id === reelId
                );
            if (reel) {
                reel.status =
                    "file_missing";
                reel.stage =
                    "File deleted";
                reel.progress =
                    0;
                saveReels(
                    reels
                );
            }
            console.log(
                `Deleted PC video for reel: ${reelId}`
            );
            broadcast({
                type: "reel_update",
                id: reelId,
                status: "file_missing",
                stage: "File deleted",
                progress: 0
            });
            res.json({
                success: true,
                message: "PC video deleted"
            });
        } catch (error) {
            console.error(
                "Failed to delete video:",
                error
            );
            res.status(500).json({
                success: false,
                message:
                    "Failed to delete video"
            });
        }
    }
);
// ========================================
// REMOVE REEL FROM QUEUE
// ========================================
app.delete(
    "/api/reels/:id",
    (req, res) => {
        const reelId =
            req.params.id;
        const reels =
            getReels();
        const reel =
            reels.find(
                item =>
                    item.id === reelId
            );
        if (!reel) {
            return res.status(404).json({
                success: false,
                message: "Reel not found"
            });
        }
        // ========================================
        // SAFETY CHECK
        // ========================================
        //
        // Failed is now removable.
        //
        // Published Reels cannot be removed
        // from SIFT until they are manually
        // deleted from Instagram.
        //
        const removableStatuses = [
            "file_missing",
            "deleted",
            "failed"
        ];
        if (
            !removableStatuses.includes(
                reel.status
            )
        ) {
            return res.status(409).json({
                success: false,
                message:
                    "Reel cannot be removed yet"
            });
        }
        const updatedReels =
            reels.filter(
                item =>
                    item.id !== reelId
            );
        saveReels(
            updatedReels
        );
        console.log(
            `Removed reel from queue: ${reelId}`
        );
        broadcast({
            type: "reel_removed",
            id: reelId
        });
        res.json({
            success: true,
            message:
                "Reel removed from queue"
        });
    }
);
// ========================================
// CHECK PUBLISHED INSTAGRAM REELS
// ========================================
let instagramCheckRunning =
    false;
async function checkPublishedReels() {
    // ========================================
    // PREVENT OVERLAPPING CHECKS
    // ========================================
    if (
        instagramCheckRunning
    ) {
        console.log(
            "Instagram check already running."
        );
        return;
    }
    instagramCheckRunning =
        true;
    try {
        const reels =
            getReels();
        const instagramReels =
            reels.filter(
                reel =>
                    (
                        reel.status ===
                            "published" ||
                        reel.status ===
                            "deleted"
                    ) &&
                    reel.instagramMediaId
            );
        if (
            instagramReels.length === 0
        ) {
            return;
        }
        console.log(
            `Checking ${instagramReels.length} Instagram Reel(s)...`
        );
        // ========================================
        // CHECK EACH REEL
        // ========================================
        for (
            const reel of instagramReels
        ) {
            try {
                const exists =
                    await isPublishedMediaPresent(
                        reel.instagramMediaId
                    );
                // ========================================
                // REEL STILL EXISTS
                // ========================================
                if (exists) {
                    // ----------------------------------------
                    // RECOVER FALSE "DELETED" STATUS
                    // ----------------------------------------
                    if (
                        reel.status ===
                            "deleted"
                    ) {
                        const currentReels =
                            getReels();
                        const currentReel =
                            currentReels.find(
                                item =>
                                    item.id ===
                                    reel.id
                            );
                        if (
                            currentReel &&
                            currentReel.status ===
                                "deleted"
                        ) {
                            currentReel.status =
                                "published";
                            currentReel.stage =
                                "Published";
                            currentReel.progress =
                                100;
                            currentReel.detail =
                                "Instagram Reel is live";
                            saveReels(
                                currentReels
                            );
                            console.log(
                                `Instagram Reel restored to published: ${reel.id}`
                            );
                            broadcast({
                                type:
                                    "reel_update",
                                id:
                                    reel.id,
                                status:
                                    "published",
                                stage:
                                    "Published",
                                progress:
                                    100,
                                detail:
                                    "Instagram Reel is live"
                            });
                        }
                    }
                    continue;
                }
                // ========================================
                // MEDIA NOT FOUND
                // ========================================
                const currentReels =
                    getReels();
                const currentReel =
                    currentReels.find(
                        item =>
                            item.id ===
                            reel.id
                    );
                if (
                    !currentReel
                ) {
                    continue;
                }
                // ========================================
                // ALREADY DELETED
                // ========================================
                if (
                    currentReel.status ===
                    "deleted"
                ) {
                    continue;
                }
                // ========================================
                // MARK AS DELETED
                // ========================================
                currentReel.status =
                    "deleted";
                currentReel.stage =
                    "Instagram deleted";
                currentReel.progress =
                    100;
                currentReel.detail =
                    "Reel deleted on Instagram";
                saveReels(
                    currentReels
                );
                console.log(
                    `Instagram Reel deleted: ${reel.id}`
                );
                broadcast({
                    type:
                        "reel_update",
                    id:
                        reel.id,
                    status:
                        "deleted",
                    stage:
                        "Instagram deleted",
                    progress:
                        100,
                    detail:
                        "Reel deleted on Instagram"
                });
            } catch (error) {
                // ========================================
                // API / NETWORK / TOKEN ERROR
                // ========================================
                //
                // NEVER mark the Reel as deleted here.
                //
                console.log(
                    `Instagram check failed for ${reel.id}:`,
                    error.message
                );
                continue;
            }
        }
    } finally {
        instagramCheckRunning =
            false;
    }
}
// ========================================
// INSTAGRAM CHECK LOOP
// ========================================
const INSTAGRAM_CHECK_INTERVAL =
    30 * 1000;
setInterval(
    () => {
        checkPublishedReels()
            .catch(error => {
                console.error(
                    "Instagram check loop failed:",
                    error
                );
            });
    },
    INSTAGRAM_CHECK_INTERVAL
);
// ========================================
// START HTTP SERVER
// ========================================
app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `SIFT API running on port ${PORT}`
        );
        // ========================================
        // RECOVER ANY REELS THAT WERE RUNNING
        // WHEN THE PREVIOUS SERVER STOPPED
        // ========================================
        recoverInterruptedReels();
        const reels =
            getReels();
        reels.forEach(
            reel => {
                // ========================================
                // COMPLETED DOWNLOAD
                // ========================================
                if (
                    reel.status ===
                    "downloaded"
                ) {
                    verifyDownloadedFile(
                        reel,
                        broadcast
                    );
                    return;
                }
                // ========================================
                // FAILED
                // ========================================
                //
                // Failed items intentionally do NOT
                // restart automatically.
                //
                // User can remove them from SIFT.
                //
                if (
                    reel.status ===
                    "failed"
                ) {
                    console.log(
                        `Failed Reel waiting for removal: ${reel.id}`
                    );
                    return;
                }
                // ========================================
                // QUEUED REEL
                // ========================================
                if (
                    reel.status ===
                    "queued"
                ) {
                    console.log(
                        "Resuming queued reel:",
                        reel.id
                    );
                    processReel(
                        reel,
                        broadcast
                    );
                }
            }
        );
        // ========================================
        // INITIAL INSTAGRAM CHECK
        // ========================================
        checkPublishedReels()
            .catch(error => {
                console.error(
                    "Initial Instagram check failed:",
                    error
                );
            });
    }
);