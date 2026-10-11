const { downloadMedia } = require("./downloader");

const {
    probeVideo,
    isCompatibleVideo,
    prepareVideo
} = require("./videoPreparer");

const {
    uploadVideo,
    deleteVideo
} = require("./cloudinaryUploader");

const {
    publishInstagramReel
} = require("./instagramUploader");

const fs = require("fs");
const path = require("path");

const queueFile = path.join(__dirname, "reels.json");

const downloadsDir = path.join(__dirname, "downloads");


// ========================================
// SIFT PIPELINE PROGRESS
// ========================================

function calculateOverallProgress(stage, stageProgress = 0) {
    const progress = Math.max(0, Math.min(100, stageProgress));

    switch (stage) {
        case "Queued":
            return 0;
        case "Downloading":
            return Math.round(progress * 0.25);
        case "Processing":
            return Math.round(25 + progress * 0.25);
        case "Cloud Uploading":
            return Math.round(50 + progress * 0.25);
        case "Publishing":
            return Math.round(75 + progress * 0.25);
        case "Published":
            return 100;
        default:
            return 0;
    }
}


// ========================================
// STATUS UPDATE
// ========================================

function updateReel(
    id,
    stage,
    status,
    stageProgress,
    detail,
    broadcast
) {
    const reels = loadReels();

    const reel = reels.find(item => item.id === id);

    if (!reel) {
        console.error("Reel not found:", id);
        return;
    }

    const overallProgress = calculateOverallProgress(
        stage,
        stageProgress
    );

    reel.stage = stage;
    reel.status = status;
    reel.progress = overallProgress;
    reel.detail = detail;

    saveReels(reels);

    console.log(
        `[${id}] ${stage} - ${detail} - ${overallProgress}%`
    );

    if (broadcast) {
        broadcast({
            type: "reel_update",
            id,
            stage,
            status,
            progress: overallProgress,
            detail
        });
    }
}


// ========================================
// SMOOTH STAGE PROGRESS
// ========================================

async function runWithSmoothProgress(
    reelId,
    stage,
    status,
    detail,
    operation,
    broadcast,
    intervalMs = 350
) {
    let stageProgress = 0;

    updateReel(
        reelId,
        stage,
        status,
        stageProgress,
        detail,
        broadcast
    );

    const interval = setInterval(() => {
        if (stageProgress < 95) {
            stageProgress += 1;

            updateReel(
                reelId,
                stage,
                status,
                stageProgress,
                detail,
                broadcast
            );
        }
    }, intervalMs);

    try {
        const result = await operation();

        clearInterval(interval);

        updateReel(
            reelId,
            stage,
            status,
            100,
            detail,
            broadcast
        );

        return result;
    } catch (error) {
        clearInterval(interval);
        throw error;
    }
}


// ========================================
// QUEUE STORAGE
// ========================================

function loadReels() {
    try {
        const data = fs.readFileSync(queueFile, "utf8");
        return JSON.parse(data);
    } catch (error) {
        console.error("Failed to load reels:", error);
        return [];
    }
}

function saveReels(reels) {
    fs.writeFileSync(
        queueFile,
        JSON.stringify(reels, null, 2)
    );
}


// ========================================
// VIDEO FILE
// ========================================

function getOutputFile(reelId) {
    return path.join(
        downloadsDir,
        `${reelId}.mp4`
    );
}


// ========================================
// VIDEO METADATA
// ========================================

async function getVideoMetadata(filePath) {
    const metadata = await probeVideo(filePath);
    const stats = await fs.promises.stat(filePath);

    return {
        width: metadata.width,
        height: metadata.height,
        duration: metadata.duration,
        sizeBytes: stats.size
    };
}


// ========================================
// VIDEO PREPARATION
// ========================================

async function processVideoFile(inputPath, reelId, broadcast) {
    updateReel(
        reelId,
        "Processing",
        "processing",
        0,
        "checking_video_format",
        broadcast
    );

    const info = await probeVideo(inputPath);

    console.log("Input video information:", info);

    if (isCompatibleVideo(info)) {
        console.log("Video is already compatible.");

        updateReel(
            reelId,
            "Processing",
            "processing",
            90,
            "verifying_prepared_video",
            broadcast
        );

        return inputPath;
    }

    console.log("Video requires preparation.");

    const preparedPath = path.join(
        downloadsDir,
        `${reelId}.prepared.mp4`
    );

    const backupPath = `${inputPath}.original.bak`;

    if (fs.existsSync(preparedPath)) {
        await fs.promises.unlink(preparedPath);
    }

    updateReel(
        reelId,
        "Processing",
        "processing",
        10,
        "processing_video",
        broadcast
    );

    await prepareVideo(inputPath, preparedPath);

    updateReel(
        reelId,
        "Processing",
        "processing",
        90,
        "verifying_prepared_video",
        broadcast
    );

    if (!fs.existsSync(preparedPath)) {
        throw new Error("Prepared video was not created.");
    }

    const preparedInfo = await probeVideo(preparedPath);

    console.log("Prepared video information:", preparedInfo);

    if (!isCompatibleVideo(preparedInfo)) {
        throw new Error(
            "Prepared video failed compatibility verification."
        );
    }

    console.log("Prepared video verified successfully.");

    if (fs.existsSync(backupPath)) {
        throw new Error(
            `A video backup already exists: ${backupPath}. ` +
            "Inspect it before continuing."
        );
    }

    await fs.promises.rename(inputPath, backupPath);

    try {
        await fs.promises.rename(preparedPath, inputPath);
    } catch (replacementError) {
        try {
            await fs.promises.rename(backupPath, inputPath);
        } catch (restoreError) {
            throw new Error(
                `Video replacement failed: ${replacementError.message}. ` +
                `Restoring the original also failed: ${restoreError.message}. ` +
                `Original backup: ${backupPath}`
            );
        }

        throw new Error(
            "Could not install prepared video. Original video restored. " +
            replacementError.message
        );
    }

    try {
        await fs.promises.unlink(backupPath);
    } catch (cleanupError) {
        console.warn(
            "Prepared video installed, but original backup could not be deleted:",
            cleanupError.message
        );
    }

    console.log("Prepared video moved to final path.");

    return inputPath;
}


// ========================================
// AUTO CLEANUP AFTER SUCCESSFUL PUBLISH
// ========================================

async function cleanupPublishedReel(reelId, cloudinaryPublicId) {
    console.log(
        `\nStarting automatic cleanup for reel ${reelId}...`
    );

    if (cloudinaryPublicId) {
        try {
            await deleteVideo(cloudinaryPublicId);

            console.log(
                `Cloudinary video deleted for reel ${reelId}.`
            );
        } catch (error) {
            console.error(
                `Cloudinary cleanup failed for reel ${reelId}:`,
                error.message
            );
        }
    } else {
        console.log("No Cloudinary public ID available.");
    }

    const outputFile = getOutputFile(reelId);

    if (fs.existsSync(outputFile)) {
        try {
            await fs.promises.unlink(outputFile);

            console.log(
                `Local video deleted for reel ${reelId}.`
            );
        } catch (error) {
            console.error(
                `Local video cleanup failed for reel ${reelId}:`,
                error.message
            );
        }
    } else {
        console.log(
            `Local video already missing for reel ${reelId}.`
        );
    }

    console.log(
        `Automatic cleanup finished for reel ${reelId}.`
    );
}


// ========================================
// SAVE SOURCE CAPTION
// ========================================

function saveCaption(reelId, caption) {
    const reels = loadReels();

    const reel = reels.find(item => item.id === reelId);

    if (!reel) {
        throw new Error(
            "Reel not found while saving caption."
        );
    }

    reel.caption = typeof caption === "string" ? caption : "";

    saveReels(reels);

    console.log(`[${reelId}] Original caption saved.`);
}


// ========================================
// MAIN PROCESSOR
// ========================================

async function processReel(reel, broadcast) {
    console.log("\n======================================");
    console.log("Processing reel with ID:", reel.id);
    console.log("======================================\n");

    try {
        // ----------------------------------------
        // VERIFY THE LATEST SAVED STATE
        // ----------------------------------------

        const latestReels = loadReels();

        const latestReel = latestReels.find(
            item => item.id === reel.id
        );

        if (!latestReel) {
            console.log(
                `Reel no longer exists in queue: ${reel.id}`
            );
            return;
        }

        if (
            latestReel.status === "publish_uncertain" ||
            latestReel.publishRecoveryRequired === true ||
            latestReel.status === "published"
        ) {
            console.warn(
                `Skipping Reel ${reel.id}: status is ${latestReel.status}`
            );
            return;
        }

        if (latestReel.status !== "queued") {
            console.warn(
                `Skipping Reel ${reel.id}: it is not queued ` +
                `(status: ${latestReel.status})`
            );
            return;
        }

        // QUEUED

        updateReel(
            reel.id,
            "Queued",
            "queued",
            0,
            "keyword_added_to_queue",
            broadcast
        );

        // DOWNLOADING

        updateReel(
            reel.id,
            "Downloading",
            "downloading",
            0,
            "initializing_download",
            broadcast
        );

        await new Promise(resolve => setTimeout(resolve, 250));

        updateReel(
            reel.id,
            "Downloading",
            "downloading",
            0,
            "fetching_media",
            broadcast
        );

        const result = await downloadMedia(
            reel.url,
            reel.id,
            downloadProgress => {
                updateReel(
                    reel.id,
                    "Downloading",
                    "downloading",
                    downloadProgress,
                    "downloading_media",
                    broadcast
                );
            }
        );

        console.log("Download completed:", result.filePath);

        // SAVE ORIGINAL CAPTION

        saveCaption(reel.id, result.caption);

        updateReel(
            reel.id,
            "Downloading",
            "downloading",
            100,
            "download_completed",
            broadcast
        );

        // CHECK DOWNLOADED FILE

        updateReel(
            reel.id,
            "Processing",
            "processing",
            0,
            "checking_download",
            broadcast
        );

        const outputFile = getOutputFile(reel.id);

        if (!fs.existsSync(outputFile)) {
            throw new Error(
                "Downloaded video file was not found."
            );
        }

        // PROCESSING

        await new Promise(resolve => setTimeout(resolve, 250));

        await runWithSmoothProgress(
            reel.id,
            "Processing",
            "processing",
            "processing_video",
            () => processVideoFile(
                outputFile,
                reel.id,
                broadcast
            ),
            broadcast,
            350
        );

        // FINAL METADATA

        const metadata = await getVideoMetadata(outputFile);

        console.log("Final video metadata:", metadata);

        const reels = loadReels();

        const currentReel = reels.find(
            item => item.id === reel.id
        );

        if (currentReel) {
            currentReel.width = metadata.width;
            currentReel.height = metadata.height;
            currentReel.duration = metadata.duration;
            currentReel.sizeBytes = metadata.sizeBytes;

            saveReels(reels);
        }

        updateReel(
            reel.id,
            "Processing",
            "processing",
            100,
            "processing_completed",
            broadcast
        );

        // CLOUD UPLOAD

        const cloudinaryResult = await runWithSmoothProgress(
            reel.id,
            "Cloud Uploading",
            "uploading",
            "uploading_to_cloudinary",
            () => uploadVideo(outputFile, reel.id),
            broadcast,
            300
        );

        console.log(
            "Cloudinary upload completed:",
            cloudinaryResult.secureUrl
        );

        updateReel(
            reel.id,
            "Cloud Uploading",
            "uploading",
            100,
            "cloud_upload_completed",
            broadcast
        );

        // GET SAVED ORIGINAL CAPTION

        const captionReels = loadReels();

        const captionReel = captionReels.find(
            item => item.id === reel.id
        );

        const originalCaption = captionReel?.caption || "";

        console.log("\nOriginal caption to publish:");
        console.log(originalCaption);

        // INSTAGRAM PUBLISHING

        const instagramResult = await runWithSmoothProgress(
            reel.id,
            "Publishing",
            "publishing",
            "creating_instagram_container",
            () => publishInstagramReel(
                cloudinaryResult.secureUrl,
                originalCaption,
                false,
                async containerId => {
                    const currentReels = loadReels();

                    const currentReel = currentReels.find(
                        item => item.id === reel.id
                    );

                    if (!currentReel) {
                        throw new Error(
                            "Reel not found while saving Instagram container ID."
                        );
                    }

                    currentReel.instagramContainerId = containerId;
                    currentReel.detail = "instagram_container_created";

                    saveReels(currentReels);

                    console.log(
                        `[${reel.id}] Instagram container ID saved: ${containerId}`
                    );
                }
            ),
            broadcast,
            500
        );

        console.log(
            "Instagram Reel published:",
            instagramResult.mediaId
        );

        updateReel(
            reel.id,
            "Publishing",
            "publishing",
            100,
            "instagram_publish_completed",
            broadcast
        );

        // SAVE FINAL INFORMATION

        const updatedReels = loadReels();

        const publishedReel = updatedReels.find(
            item => item.id === reel.id
        );

        if (publishedReel) {
            publishedReel.instagramContainerId =
                instagramResult.containerId;

            publishedReel.instagramMediaId =
                instagramResult.mediaId;

            publishedReel.cloudinaryPublicId =
                cloudinaryResult.publicId;

            publishedReel.cloudinaryUrl =
                cloudinaryResult.secureUrl;

            publishedReel.status = "published";
            publishedReel.stage = "Published";
            publishedReel.progress = 100;
            publishedReel.detail = "instagram_publish_complete";

            publishedReel.publishedAt = new Date().toISOString();

            publishedReel.publishRecoveryRequired = false;

            saveReels(updatedReels);
        }

        // FINAL BROADCAST

        if (broadcast) {
            broadcast({
                type: "reel_update",
                id: reel.id,
                stage: "Published",
                status: "published",
                progress: 100,
                detail: "instagram_publish_complete"
            });
        }

        console.log("\n======================================");
        console.log(
            `SIFT: Reel ${reel.id} published successfully.`
        );
        console.log("======================================\n");

        // AUTO CLEANUP

        await cleanupPublishedReel(
            reel.id,
            cloudinaryResult.publicId
        );

    } catch (error) {
        console.error("\nProcessing failed:");
        console.error(error);

        // UNCERTAIN INSTAGRAM PUBLISH RESULT

        if (error.uncertain === true) {
            const reels = loadReels();

            const currentReel = reels.find(
                item => item.id === reel.id
            );

            if (currentReel) {
                currentReel.stage = "Publishing";
                currentReel.status = "publish_uncertain";
                currentReel.progress = 75;

                currentReel.detail =
                    "instagram_publish_result_uncertain_manual_check_required";

                currentReel.publishRecoveryRequired = true;
                currentReel.lastError = error.message;

                if (error.containerId) {
                    currentReel.instagramContainerId =
                        error.containerId;
                }

                saveReels(reels);
            }

            console.error(
                `[${reel.id}] Instagram publishing result is uncertain.`
            );

            console.error(
                "Do not retry this Reel until the Instagram account is checked."
            );

            if (broadcast) {
                broadcast({
                    type: "reel_update",
                    id: reel.id,
                    stage: "Publishing",
                    status: "publish_uncertain",
                    progress: 75,
                    detail:
                        "instagram_publish_result_uncertain_manual_check_required"
                });
            }

            return;
        }

        // OTHER PROCESSING ERRORS

        const reels = loadReels();

        const currentReel = reels.find(
            item => item.id === reel.id
        );

        if (currentReel) {
            currentReel.lastError = error.message;
            saveReels(reels);
        }

        updateReel(
            reel.id,
            "Failed",
            "failed",
            0,
            "video_processing_failed",
            broadcast
        );
    }
}


// ========================================
// VERIFY DOWNLOADED FILE
// ========================================

function verifyDownloadedFile(reel, broadcast) {
    if (reel.status !== "downloaded") {
        return;
    }

    const outputFile = getOutputFile(reel.id);

    if (!fs.existsSync(outputFile)) {
        console.log(
            `Downloaded file missing for reel ${reel.id}`
        );

        updateReel(
            reel.id,
            "File missing",
            "file_missing",
            0,
            "downloaded_file_not_found",
            broadcast
        );
    }
}


// ========================================
// EXPORTS
// ========================================

module.exports = {
    processReel,
    verifyDownloadedFile
};