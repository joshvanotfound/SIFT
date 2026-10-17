require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const {
    addReel,
    getReels,
    saveReels
} = require("./queue");

const {
    processReel,
    verifyDownloadedFile,
    cleanupInterruptedReel
} = require("./processor");

const {
    isPublishedMediaPresent,
    getAllAccountMedia
} = require("./instagramUploader");

const app = express();

const PORT = 3000;
const WEBSOCKET_PORT = 3001;

const INSTAGRAM_CHECK_INTERVAL = 30 * 1000;

// Remains false until startup recovery finishes successfully.
// New Reel submissions are rejected while this is false.
let startupRecoveryFinished = false;


// ========================================
// ACTIVE REEL PROCESSING LOCK
// ========================================

const processingReels = new Set();

function startReelProcessing(reel) {
    if (processingReels.has(reel.id)) {
        console.log(
            `Reel is already processing: ${reel.id}`
        );

        return false;
    }

    processingReels.add(reel.id);

    processReel(reel, broadcast)
        .catch(error => {
            console.error(
                `Unexpected processing error for ${reel.id}:`,
                error
            );
        })
        .finally(() => {
            processingReels.delete(reel.id);
        });

    return true;
}


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
    const data = JSON.stringify(message);

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

wss.on("connection", socket => {
    console.log("WebSocket client connected");

    socket.send(JSON.stringify({
        type: "connection",
        message: "WebSocket connected"
    }));

    socket.on("close", () => {
        console.log("WebSocket client disconnected");
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
        const url = new URL(value);

        return (
            url.protocol === "http:" ||
            url.protocol === "https:"
        );
    } catch {
        return false;
    }
}


// ========================================
// MARK PUBLISHING STATE AS UNCERTAIN
// ========================================

function markPublishUncertain(reelId, detail, message) {
    const currentReels = getReels();

    const currentReel = currentReels.find(
        item => item.id === reelId
    );

    if (!currentReel) {
        console.warn(
            `[${reelId}] Cannot update publishing state: Reel not found.`
        );
        return false;
    }

    if (currentReel.status === "published") {
        console.warn(
            `[${reelId}] Already published. Preserving published state.`
        );
        return false;
    }

    currentReel.status = "failed";
    currentReel.stage = "Publishing needs verification";
    currentReel.detail =
        "instagram_publish_uncertain_check_instagram_before_retry";
    currentReel.lastError = message;
    currentReel.publishRecoveryRequired = true;

    saveReels(currentReels);

    console.warn(
        `[${reelId}] WARNING: Instagram publishing outcome is uncertain.`
    );
    console.warn(
        "Check your Instagram Reels. If this Reel was uploaded, " +
        "delete it manually before retrying."
    );

    broadcast({
        type: "reel_update",
        id: reelId,
        status: "failed",
        stage: currentReel.stage,
        progress: currentReel.progress ?? 75,
        detail: currentReel.detail,
        warning:
            "Check Instagram. If this Reel was uploaded, delete it manually before retrying."
    });

    return true;
}


// ========================================
// RECOVER INTERRUPTED REELS SAFELY
// ========================================

async function recoverInterruptedReels() {
    const initialReels = getReels();

    const restartableStatuses = [
        "downloading",
        "processing",
        "uploading",
        "interrupted"
    ];

    for (const reel of initialReels) {
        if (reel.status === "published") {
            continue;
        }

        const needsPublishRecovery =
            reel.publishAttemptStarted === true ||
            reel.status === "publish_uncertain" ||
            reel.status === "publishing" ||
            reel.publishRecoveryRequired === true;

        if (needsPublishRecovery) {
            console.log(
                `[${reel.id}] Checking Instagram after interrupted publishing...`
            );

            try {
                const snapshot = Array.isArray(
                    reel.instagramMediaBeforePublish
                )
                    ? reel.instagramMediaBeforePublish
                    : [];

                const previousIds = new Set(
                    snapshot.map(media => media.id)
                );

                const currentMedia = await getAllAccountMedia();

                const newMedia = currentMedia.filter(
                    media => !previousIds.has(media.id)
                );

                // Automatically recover only when exactly one new Reel
                // matches the saved caption.
                const matchingMedia = newMedia.filter(media =>
                    ["VIDEO", "REELS"].includes(media.media_type) &&
                    typeof media.caption === "string" &&
                    media.caption === (reel.caption || "")
                );

                if ( 
                    matchingMedia.length === 1 &&
                    reel.instagramMediaId &&
                    matchingMedia[0].id === 
                reel.instagramMediaId
                ) {
                    const matched = matchingMedia[0];
                    const currentReels = getReels();
                    const currentReel = currentReels.find(
                        item => item.id === reel.id
                    );

                    if (!currentReel) {
                        continue;
                    }

                    currentReel.status = "published";
                    currentReel.stage = "Published";
                    currentReel.progress = 100;
                    currentReel.instagramMediaId = matched.id;
                    currentReel.detail =
                        "instagram_publish_confirmed_during_startup_recovery";
                    currentReel.publishedAt =
                        matched.timestamp || new Date().toISOString();
                    currentReel.publishRecoveryRequired = false;
                    currentReel.publishAttemptStarted = false;
                    currentReel.lastError = null;

                    saveReels(currentReels);

                    broadcast({
                        type: "reel_update",
                        id: reel.id,
                        status: "published",
                        stage: "Published",
                        progress: 100,
                        detail: currentReel.detail
                    });

                    console.log(
                        `[${reel.id}] Instagram Reel confirmed: ${matched.id}`
                    );

                    continue;
                }

                const message = snapshot.length === 0
                    ? "No saved Instagram snapshot is available. Check Instagram manually before retrying."
                    : matchingMedia.length > 1
                        ? "Multiple new Reels match this caption. Check Instagram manually before retrying."
                        : "SIFT could not confidently identify the published Reel. Check Instagram manually before retrying.";

                markPublishUncertain(
                    reel.id,
                    "instagram_publish_uncertain_check_instagram_before_retry",
                    message
                );

            } catch (error) {
                console.error(
                    `[${reel.id}] Instagram recovery check failed:`,
                    error.message
                );

                markPublishUncertain(
                    reel.id,
                    "instagram_recovery_check_failed_manual_check_required",
                    "SIFT could not check Instagram. Check your Reels manually before retrying."
                );
            }

            continue;
        }

        if (!restartableStatuses.includes(reel.status)) {
            continue;
        }

        console.log(
            `[${reel.id}] Interrupted Reel detected. Previous status: ${reel.status}`
        );

        try {
            await cleanupInterruptedReel(reel.id);

            const currentReels = getReels();
            const currentReel = currentReels.find(
                item => item.id === reel.id
            );

            if (
                !currentReel ||
                !restartableStatuses.includes(currentReel.status) ||
                currentReel.publishAttemptStarted === true ||
                currentReel.publishRecoveryRequired === true
            ) {
                continue;
            }

            currentReel.status = "queued";
            currentReel.stage = "Queued";
            currentReel.progress = 0;
            currentReel.detail =
                "restarting_from_download_after_server_restart";
            currentReel.lastError = null;

            delete currentReel.cloudinaryPublicId;
            delete currentReel.cloudinaryUrl;
            delete currentReel.instagramContainerId;

            saveReels(currentReels);

            Object.assign(reel, currentReel);

            console.log(
                `[${reel.id}] Cleanup completed. Reel reset to queued.`
            );

        } catch (error) {
            console.error(
                `[${reel.id}] Recovery cleanup failed:`,
                error.message
            );

            const currentReels = getReels();
            const currentReel = currentReels.find(
                item => item.id === reel.id
            );

            if (!currentReel) {
                continue;
            }

            currentReel.status = "failed";
            currentReel.stage = "Recovery cleanup failed";
            currentReel.progress = 0;
            currentReel.detail =
                "recovery_cleanup_failed_manual_attention_required";
            currentReel.lastError = error.message;

            saveReels(currentReels);

            broadcast({
                type: "reel_update",
                id: reel.id,
                status: "failed",
                stage: currentReel.stage,
                progress: 0,
                detail: currentReel.detail
            });
        }
    }

    console.log("Interrupted Reel recovery checks completed.");
}


// ========================================
// SERVER STATUS
// ========================================

app.get("/api/status", (req, res) => {
    res.json({
        status: "online",
        service: "SIFT",
        ready: startupRecoveryFinished
    });
});


// ========================================
// ADD REEL
// ========================================

app.post("/api/reels", (req, res) => {
    if (!startupRecoveryFinished) {
        return res.status(503).json({
            success: false,
            message:
                "SIFT is recovering interrupted jobs. Try again when startup recovery finishes."
        });
    }

    const { url } = req.body;

    if (!url || typeof url !== "string") {
        return res.status(400).json({
            success: false,
            message: "URL is required"
        });
    }

    const cleanUrl = url.trim();

    if (!isValidUrl(cleanUrl)) {
        return res.status(400).json({
            success: false,
            message: "Invalid URL"
        });
    }

    const reel = addReel(cleanUrl);

    console.log("Reel added to queue:", reel);

    startReelProcessing(reel);

    res.json({
        success: true,
        message: "Reel added to queue",
        reel
    });
});


// ========================================
// GET REELS
// ========================================

app.get("/api/reels", (req, res) => {
    const reels = getReels().map(reel => {
        if (
            reel.status === "failed" &&
            reel.publishRecoveryRequired === true
        ) {
            return {
                ...reel,
                warning:
                    "Check Instagram. If this Reel was uploaded, delete it manually before retrying."
            };
        }

        return reel;
    });

    res.json(reels);
});


// ========================================
// SERVE REEL VIDEO
// ========================================

app.get("/api/reels/:id/video", (req, res) => {
    const reelId = req.params.id;

    const filePath = path.join(
        __dirname,
        "downloads",
        `${reelId}.mp4`
    );

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({
            success: false,
            message: "Video file not found"
        });
    }

    res.sendFile(filePath);
});


// ========================================
// DELETE PC VIDEO
// ========================================

app.delete("/api/reels/:id/file", (req, res) => {
    const reelId = req.params.id;

    const filePath = path.join(
        __dirname,
        "downloads",
        `${reelId}.mp4`
    );

    const reels = getReels();

    const reel = reels.find(
        item => item.id === reelId
    );

    if (!reel) {
        return res.status(404).json({
            success: false,
            message: "Reel not found"
        });
    }

    // Never delete a file while processing or publishing is active.
    if (
        processingReels.has(reelId) ||
        [
            "downloading",
            "processing",
            "uploading",
            "publishing",
            "publish_uncertain"
        ].includes(reel.status) ||
        reel.publishAttemptStarted === true ||
        reel.publishRecoveryRequired === true
    ) {
        return res.status(409).json({
            success: false,
            message:
                "This Reel is processing or requires Instagram verification. Its file cannot be deleted yet."
        });
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({
            success: false,
            message: "Video file not found"
        });
    }

    try {
        fs.unlinkSync(filePath);

        // Deleting the PC copy must not overwrite a known Instagram state.
        if (
            reel.status !== "published" &&
            reel.status !== "deleted"
        ) {
            reel.status = "file_missing";
            reel.stage = "File deleted";
            reel.progress = 0;
        }

        saveReels(reels);

        broadcast({
            type: "reel_update",
            id: reelId,
            status: reel.status,
            stage: reel.stage,
            progress: reel.progress
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
            message: "Failed to delete video"
        });
    }
});


// ========================================
// REMOVE REEL FROM QUEUE
// ========================================

app.delete("/api/reels/:id", (req, res) => {
    const reelId = req.params.id;

    const reels = getReels();

    const reel = reels.find(
        item => item.id === reelId
    );

    if (!reel) {
        return res.status(404).json({
            success: false,
            message: "Reel not found"
        });
    }

    // Never remove active jobs or jobs with an uncertain publish result.
    if (
        processingReels.has(reelId) ||
        [
            "downloading",
            "processing",
            "uploading",
            "publishing",
            "publish_uncertain",
            "published"
        ].includes(reel.status) ||
        reel.publishAttemptStarted === true ||
        reel.publishRecoveryRequired === true
    ) {
        return res.status(409).json({
            success: false,
            message:
                "This Reel is active, published, or requires Instagram verification. It cannot be removed yet."
        });
    }

    // Failed jobs with incomplete cleanup must remain for investigation.
    const cleanupFailed =
        reel.stage === "Recovery cleanup failed" ||
        reel.detail === "recovery_cleanup_failed_manual_attention_required";

    const hasCloudinaryReference =
        Boolean(reel.cloudinaryPublicId) ||
        Boolean(reel.cloudinaryUrl);

    if (
        reel.status === "failed" &&
        (cleanupFailed || hasCloudinaryReference)
    ) {
        return res.status(409).json({
            success: false,
            message:
                "Cleanup is not confirmed complete. Keep this record until its remaining files and Cloudinary assets are checked."
        });
    }

    const removableStatuses = [
        "file_missing",
        "deleted",
        "failed"
    ];

    if (!removableStatuses.includes(reel.status)) {
        return res.status(409).json({
            success: false,
            message: "Reel cannot be removed yet"
        });
    }

    const updatedReels = reels.filter(
        item => item.id !== reelId
    );

    saveReels(updatedReels);

    console.log(
        `Removed reel from queue: ${reelId}`
    );

    broadcast({
        type: "reel_removed",
        id: reelId
    });

    res.json({
        success: true,
        message: "Reel removed from queue"
    });
});


// ========================================
// CHECK PUBLISHED INSTAGRAM REELS
// ========================================

let instagramCheckRunning = false;

async function checkPublishedReels() {
    if (instagramCheckRunning) {
        return;
    }

    instagramCheckRunning = true;

    try {
        const reels = getReels();

        const instagramReels = reels.filter(
            reel =>
                (
                    reel.status === "published" ||
                    reel.status === "deleted"
                ) &&
                reel.instagramMediaId
        );

        if (instagramReels.length === 0) {
            return;
        }

        console.log(
            `Checking ${instagramReels.length} Instagram Reel(s)...`
        );

        for (const reel of instagramReels) {
            try {
                const exists = await isPublishedMediaPresent(
                    reel.instagramMediaId
                );

                if (exists) {
                    if (reel.status === "deleted") {
                        const currentReels = getReels();

                        const currentReel = currentReels.find(
                            item => item.id === reel.id
                        );

                        if (
                            currentReel &&
                            currentReel.status === "deleted"
                        ) {
                            currentReel.status = "published";
                            currentReel.stage = "Published";
                            currentReel.progress = 100;
                            currentReel.detail =
                                "Instagram Reel is live";

                            saveReels(currentReels);

                            broadcast({
                                type: "reel_update",
                                id: reel.id,
                                status: "published",
                                stage: "Published",
                                progress: 100,
                                detail: "Instagram Reel is live"
                            });
                        }
                    }

                    continue;
                }

                const currentReels = getReels();

                const currentReel = currentReels.find(
                    item => item.id === reel.id
                );

                if (!currentReel || currentReel.status === "deleted") {
                    continue;
                }

                currentReel.status = "deleted";
                currentReel.stage = "Instagram deleted";
                currentReel.progress = 100;
                currentReel.detail =
                    "Reel deleted on Instagram";

                saveReels(currentReels);

                broadcast({
                    type: "reel_update",
                    id: reel.id,
                    status: "deleted",
                    stage: "Instagram deleted",
                    progress: 100,
                    detail: "Reel deleted on Instagram"
                });

            } catch (error) {
                // A network/API error is not proof that the Reel was deleted.
                console.log(
                    `Instagram check failed for ${reel.id}:`,
                    error.message
                );
            }
        }

    } finally {
        instagramCheckRunning = false;
    }
}


// ========================================
// INSTAGRAM CHECK LOOP
// ========================================

setInterval(() => {
    checkPublishedReels().catch(error => {
        console.error(
            "Instagram check loop failed:",
            error
        );
    });
}, INSTAGRAM_CHECK_INTERVAL);


// ========================================
// START HTTP SERVER
// ========================================

app.listen(PORT, "0.0.0.0", async () => {
    console.log(
        `SIFT API running on port ${PORT}`
    );

    try {
        await recoverInterruptedReels();

        const reels = getReels();

        for (const reel of reels) {

            if (reel.status === "downloaded") {
                verifyDownloadedFile(reel, broadcast);
                continue;
            }

            if (
                reel.status === "publish_uncertain" ||
                reel.status === "publishing" ||
                reel.publishRecoveryRequired === true ||
                reel.publishAttemptStarted === true
            ) {
                console.warn(
                    `[${reel.id}] Waiting for manual Instagram verification.`
                );

                continue;
            }

            if (reel.status === "failed") {
                console.log(
                    `Failed Reel waiting for review: ${reel.id}`
                );

                continue;
            }

            if (reel.status === "queued") {
                console.log(
                    "Resuming queued Reel:",
                    reel.id
                );

                startReelProcessing(reel);
            }
        }

        startupRecoveryFinished = true;

        console.log(
            "SIFT startup recovery completed. Server is ready."
        );

        checkPublishedReels().catch(error => {
            console.error(
                "Initial Instagram check failed:",
                error
            );
        });

    } catch (error) {
        startupRecoveryFinished = false;

        console.error(
            "Startup recovery failed. Queued jobs will not be resumed:",
            error
        );
    }
});