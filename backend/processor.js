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
    publishInstagramReel,
    getAllAccountMedia
} = require("./instagramUploader");

const fs = require("fs");
const path = require("path");

const {
    getReels,
    saveReels,
    updateReel: updateQueuedReel
} = require("./queue");

const downloadsDir = path.join(__dirname, "downloads");


// ========================================
// CLOUDINARY PUBLIC ID
// ========================================

function getCloudinaryPublicId(reelId) {
    return `sift/reels/${reelId}`;
}


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
    const overallProgress = calculateOverallProgress(
        stage,
        stageProgress
    );

    updateQueuedReel(id, {
        stage,
        status,
        progress: overallProgress,
        detail
    });

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

            try {
                updateReel(
                    reelId,
                    stage,
                    status,
                    stageProgress,
                    detail,
                    broadcast
                );
            } catch (error) {
                console.error(
                    `[${reelId}] Progress update failed:`,
                    error.message
                );
            }
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
// VIDEO FILE PATHS
// ========================================

function getOutputFile(reelId) {
    return path.join(downloadsDir, `${reelId}.mp4`);
}

function getPreparedFile(reelId) {
    return path.join(downloadsDir, `${reelId}.prepared.mp4`);
}

function getBackupFile(reelId) {
    return `${getOutputFile(reelId)}.original.bak`;
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

    const preparedPath = getPreparedFile(reelId);
    const backupPath = getBackupFile(reelId);

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
            "Cleanup is required before processing can continue."
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

    // The backup must be removed before processing continues.
    // If removal fails, the main error handler will attempt full cleanup.

    await fs.promises.unlink(backupPath);

    console.log("Prepared video moved to final path.");

    return inputPath;
}


// ========================================
// CLEANUP LOCAL REEL FILES
// ========================================

async function cleanupLocalReelFiles(reelId) {
    const files = [
        getOutputFile(reelId),
        getPreparedFile(reelId),
        getBackupFile(reelId)
    ];

    const failures = [];

    for (const filePath of files) {
        try {
            await fs.promises.unlink(filePath);

            console.log(
                `[${reelId}] Removed local file: ${path.basename(filePath)}`
            );
        } catch (error) {
            // A missing file is already clean.
            if (error.code !== "ENOENT") {
                failures.push(
                    `${path.basename(filePath)}: ${error.message}`
                );

                console.error(
                    `[${reelId}] Failed to remove ${filePath}:`,
                    error.message
                );
            }
        }
    }

    // Verify that all expected artifacts are absent.
    for (const filePath of files) {
        try {
            await fs.promises.access(filePath);

            failures.push(
                `${path.basename(filePath)} still exists after cleanup`
            );
        } catch (error) {
            if (error.code !== "ENOENT") {
                failures.push(
                    `Could not verify ${path.basename(filePath)}: ` +
                    error.message
                );
            }
        }
    }

    return failures;
}


// ========================================
// SHARED REEL CLEANUP
// ========================================

async function cleanupReelArtifacts(
    reelId,
    cloudinaryPublicId,
    { strict = false } = {}
) {
    console.log(
        `\nStarting cleanup for Reel ${reelId}...`
    );

    // Always attempt every local deletion, even if one fails.
    const failures = await cleanupLocalReelFiles(reelId);

    if (cloudinaryPublicId) {
        try {
            const result = await deleteVideo(cloudinaryPublicId);

            // Cloudinary destroy normally returns "ok" when deleted
            // and "not found" when no matching asset exists.
            if (
                result?.result !== "ok" &&
                result?.result !== "not found"
            ) {
                throw new Error(
                    `Unexpected Cloudinary deletion result: ${
                        result?.result ?? "no result returned"
                    }`
                );
            }

            console.log(
                `[${reelId}] Cloudinary cleanup result: ` +
                `${result.result} (${cloudinaryPublicId})`
            );
        } catch (error) {
            failures.push(
                `Cloudinary asset ${cloudinaryPublicId}: ${error.message}`
            );

            console.error(
                `[${reelId}] Cloudinary cleanup failed:`,
                error.message
            );
        }
    }

    if (failures.length > 0) {
        const message =
            `Cleanup incomplete for Reel ${reelId}: ` +
            failures.join("; ");

        if (strict) {
            throw new Error(message);
        }

        console.error(message);
        return false;
    }

    console.log(
        `Cleanup completed for Reel ${reelId}.`
    );

    return true;
}


// ========================================
// CLEANUP INTERRUPTED REEL BEFORE RECOVERY
// ========================================

async function cleanupInterruptedReel(reelId) {
    const reels = getReels();

    const reel = reels.find(item => item.id === reelId);

    if (!reel) {
        throw new Error(
            `Cannot clean up Reel ${reelId}: it was not found in the queue.`
        );
    }

    // Never delete assets belonging to a confirmed or potentially
    // published Reel during interrupted-job recovery.
    if (
        reel.status === "published" ||
        reel.status === "publish_uncertain" ||
        reel.publishAttemptStarted === true ||
        reel.publishRecoveryRequired === true
    ) {
        throw new Error(
            `Recovery cleanup blocked for Reel ${reelId}: ` +
            "its publishing state must be preserved."
        );
    }

    console.log(
        `[${reelId}] Cleaning abandoned files before recovery.`
    );

    // The public ID is deterministic, so this also attempts to
    // remove an upload whose successful response was never saved.
    return cleanupReelArtifacts(
        reelId,
        reel.cloudinaryPublicId || getCloudinaryPublicId(reelId),
        { strict: true }
    );
}


// ========================================
// AUTO CLEANUP AFTER SUCCESSFUL PUBLISH
// ========================================

async function cleanupPublishedReel(reelId, cloudinaryPublicId) {
    return cleanupReelArtifacts(
        reelId,
        cloudinaryPublicId || getCloudinaryPublicId(reelId),
        { strict: false }
    );
}


// ========================================
// SAVE SOURCE CAPTION
// ========================================

function saveCaption(reelId, caption) {
    const reels = getReels();

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
        // VERIFY THE LATEST SAVED STATE

        const latestReels = getReels();

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
            latestReel.publishAttemptStarted === true ||
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

        const reels = getReels();

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

        // ========================================
        // CLOUD UPLOAD
        // ========================================

        // Persist the predictable public ID before uploading.
        // Recovery can then find an asset even if the server crashes
        // after Cloudinary accepts the upload but before the response
        // is saved locally.

        const expectedPublicId = getCloudinaryPublicId(reel.id);

        updateQueuedReel(reel.id, {
            cloudinaryPublicId: expectedPublicId,
            cloudinaryUrl: null,
            detail: "cloud_upload_preparing"
        });

        console.log(
            `[${reel.id}] Cloudinary public ID saved before upload: ` +
            expectedPublicId
        );

        const cloudinaryResult = await runWithSmoothProgress(
            reel.id,
            "Cloud Uploading",
            "uploading",
            "uploading_to_cloudinary",
            () => uploadVideo(outputFile, reel.id),
            broadcast,
            300
        );

        if (cloudinaryResult.publicId !== expectedPublicId) {
            throw new Error(
                `Cloudinary public ID mismatch. Expected ` +
                `${expectedPublicId}, received ${cloudinaryResult.publicId}.`
            );
        }

        // SAVE COMPLETED UPLOAD DETAILS

        updateQueuedReel(reel.id, {
            cloudinaryPublicId: cloudinaryResult.publicId,
            cloudinaryUrl: cloudinaryResult.secureUrl,
            detail: "cloud_upload_completed"
        });

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

        const captionReels = getReels();

        const captionReel = captionReels.find(
            item => item.id === reel.id
        );

        const originalCaption = captionReel?.caption || "";

        console.log("\nOriginal caption to publish:");
        console.log(originalCaption);

        // ========================================
        // INSTAGRAM PUBLISHING
        // ========================================

        const instagramResult = await runWithSmoothProgress(
            reel.id,
            "Publishing",
            "publishing",
            "creating_instagram_container",
            () => publishInstagramReel(
                cloudinaryResult.secureUrl,
                originalCaption,
                false,

                // SAVE CONTAINER ID BEFORE WAITING

                async containerId => {
                    updateQueuedReel(reel.id, {
                        instagramContainerId: containerId,
                        detail: "instagram_container_created"
                    });

                    console.log(
                        `[${reel.id}] Instagram container ID saved: ${containerId}`
                    );
                },

                // SAVE INSTAGRAM SNAPSHOT AND SAFETY MARKER BEFORE media_publish

                async containerId => {
                    const instagramMediaBeforePublish =
                        await getAllAccountMedia();

                    updateQueuedReel(reel.id, {
                        instagramContainerId: containerId,
                        instagramMediaBeforePublish,
                        publishAttemptStarted: true,
                        stage: "Publishing",
                        status: "publishing",
                        progress: 75,
                        detail: "instagram_publish_attempt_started"
                    });

                    console.log(
                        `[${reel.id}] Instagram snapshot saved: ` +
                        `${instagramMediaBeforePublish.length} existing media items.`
                    );

                    console.log(
                        `[${reel.id}] Publish safety marker saved.`
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

        // SAVE FINAL INFORMATION

        const publishedReel = updateQueuedReel(reel.id, {
            instagramContainerId: instagramResult.containerId,
            instagramMediaId: instagramResult.mediaId,
            cloudinaryPublicId: cloudinaryResult.publicId,
            cloudinaryUrl: cloudinaryResult.secureUrl,
            status: "published",
            stage: "Published",
            progress: 100,
            detail: "instagram_publish_complete",
            publishedAt: new Date().toISOString(),
            publishRecoveryRequired: false
        });

        // FINAL BROADCAST

        if (broadcast) {
            broadcast({
                type: "reel_update",
                id: publishedReel.id,
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

        // AUTO CLEANUP AFTER SUCCESS.
        // A cleanup failure must not undo the confirmed publication.

        await cleanupPublishedReel(
            reel.id,
            cloudinaryResult.publicId
        );

    } catch (error) {
        console.error("\nProcessing failed:");
        console.error(error);

        let currentReel;

        try {
            currentReel = getReels().find(
                item => item.id === reel.id
            );
        } catch (queueError) {
            console.error(
                `[${reel.id}] Could not read queue after failure:`,
                queueError.message
            );

            // Do not perform destructive cleanup if the current publishing
            // state cannot be read safely.
            return;
        }

        if (!currentReel) {
            console.warn(
                `[${reel.id}] Queue record is missing after failure.`
            );
            return;
        }

        // NEVER CLEAN UP OR RETRY A CONFIRMED PUBLISHED REEL.

        if (currentReel.status === "published") {
            console.warn(
                `[${reel.id}] Publication is confirmed. ` +
                "Preserving the published record."
            );
            return;
        }

        // UNCERTAIN INSTAGRAM PUBLISH RESULT.
        //
        // If the safety marker was persisted, publication might have
        // happened even if a later local operation failed.
        // Preserve the source asset until publication is investigated.

        const publishUncertain =
            error.uncertain === true ||
            currentReel.publishAttemptStarted === true ||
            currentReel.publishRecoveryRequired === true ||
            currentReel.status === "publish_uncertain";

        if (publishUncertain) {
            try {
                updateQueuedReel(reel.id, {
                    stage: "Publishing",
                    status: "publish_uncertain",
                    progress: 75,
                    detail:
                        "instagram_publish_result_uncertain_manual_check_required",
                    publishRecoveryRequired: true,
                    lastError: error.message,
                    ...(error.containerId
                        ? { instagramContainerId: error.containerId }
                        : {})
                });

                console.error(
                    `[${reel.id}] Instagram publishing result is uncertain.`
                );

                console.error(
                    "Do not retry or delete publishing assets until Instagram is checked."
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
            } catch (saveError) {
                console.error(
                    `[${reel.id}] CRITICAL: Could not persist uncertain ` +
                    "publishing state:",
                    saveError.message
                );
            }

            return;
        }

        // ========================================
        // NON-PUBLISHING FAILURE
        // ========================================
        //
        // Attempt local and Cloudinary cleanup before leaving the job
        // failed. Use the deterministic ID even if uploadVideo never
        // returned its result.

        let cleanupSucceeded = false;
        let cleanupError = null;

        try {
            await cleanupReelArtifacts(
                reel.id,
                currentReel.cloudinaryPublicId ||
                    getCloudinaryPublicId(reel.id),
                { strict: true }
            );

            cleanupSucceeded = true;
        } catch (cleanupFailure) {
            cleanupError = cleanupFailure;
            console.error(
                `[${reel.id}] Cleanup after processing failure was incomplete:`,
                cleanupFailure.message
            );
        }

        // Keep the failed record for diagnosis.
        // If cleanup failed, preserve the Cloudinary ID so a later
        // cleanup attempt still knows which remote asset to remove.

        try {
            const updates = {
                stage: cleanupSucceeded
                    ? "Failed"
                    : "Recovery cleanup failed",
                status: "failed",
                progress: 0,
                detail: cleanupSucceeded
                    ? "processing_failed_artifacts_cleaned_manual_restart_required"
                    : "processing_failed_cleanup_incomplete_manual_attention_required",
                lastError: cleanupError
                    ? `${error.message}; Cleanup failure: ${cleanupError.message}`
                    : error.message
            };

            if (cleanupSucceeded) {
                updates.cloudinaryPublicId = null;
                updates.cloudinaryUrl = null;
            }

            updateQueuedReel(reel.id, updates);

            if (broadcast) {
                broadcast({
                    type: "reel_update",
                    id: reel.id,
                    stage: updates.stage,
                    status: "failed",
                    progress: 0,
                    detail: updates.detail
                });
            }
        } catch (saveError) {
            console.error(
                `[${reel.id}] CRITICAL: Failed to save the final error ` +
                "state. Inspect the queue and artifacts before retrying:",
                saveError.message
            );
        }
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
    verifyDownloadedFile,
    cleanupInterruptedReel,
    cleanupPublishedReel,

    // Shared helpers for coordinated server recovery and cleanup.
    cleanupReelArtifacts,
    cleanupLocalReelFiles,
    getCloudinaryPublicId
};