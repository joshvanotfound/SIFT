const { downloadMedia } =
    require("./downloader");

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

const fs =
    require("fs");

const path =
    require("path");


const queueFile =
    path.join(
        __dirname,
        "reels.json"
    );

const downloadsDir =
    path.join(
        __dirname,
        "downloads"
    );


// ========================================
// SIFT PIPELINE PROGRESS
// ========================================
//
// Queued
//    ↓
// Downloading       0 → 25%
//    ↓
// Processing       25 → 50%
//    ↓
// Cloud Upload     50 → 75%
//    ↓
// Publishing       75 → 100%
//    ↓
// Published             100%
// ========================================


// ========================================
// CALCULATE OVERALL PROGRESS
// ========================================

function calculateOverallProgress(
    stage,
    stageProgress = 0
) {

    const progress =
        Math.max(
            0,
            Math.min(
                100,
                stageProgress
            )
        );


    switch (stage) {

        case "Queued":

            return 0;


        case "Downloading":

            return Math.round(
                progress * 0.25
            );


        case "Processing":

            return Math.round(
                25 +
                progress * 0.25
            );


        case "Cloud Uploading":

            return Math.round(
                50 +
                progress * 0.25
            );


        case "Publishing":

            return Math.round(
                75 +
                progress * 0.25
            );


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

    const reels =
        loadReels();


    const reel =
        reels.find(
            item =>
                item.id === id
        );


    if (!reel) {

        console.error(
            "Reel not found:",
            id
        );

        return;
    }


    const overallProgress =
        calculateOverallProgress(
            stage,
            stageProgress
        );


    reel.stage =
        stage;

    reel.status =
        status;

    reel.progress =
        overallProgress;

    reel.detail =
        detail;


    saveReels(
        reels
    );


    console.log(
        `[${id}] ${stage} - ${detail} - ${overallProgress}%`
    );


    if (broadcast) {

        broadcast({

            type:
                "reel_update",

            id:
                id,

            stage:
                stage,

            status:
                status,

            progress:
                overallProgress,

            detail:
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

    let stageProgress =
        0;


    updateReel(
        reelId,
        stage,
        status,
        stageProgress,
        detail,
        broadcast
    );


    const interval =
        setInterval(
            () => {

                if (
                    stageProgress <
                    95
                ) {

                    stageProgress +=
                        1;


                    updateReel(
                        reelId,
                        stage,
                        status,
                        stageProgress,
                        detail,
                        broadcast
                    );
                }

            },
            intervalMs
        );


    try {

        const result =
            await operation();


        clearInterval(
            interval
        );


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

        clearInterval(
            interval
        );

        throw error;
    }
}


// ========================================
// QUEUE STORAGE
// ========================================

function loadReels() {

    try {

        const data =
            fs.readFileSync(
                queueFile,
                "utf8"
            );


        return JSON.parse(
            data
        );

    } catch (error) {

        console.error(
            "Failed to load reels:",
            error
        );

        return [];
    }
}


function saveReels(
    reels
) {

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
// VIDEO FILE
// ========================================

function getOutputFile(
    reelId
) {

    return path.join(
        downloadsDir,
        `${reelId}.mp4`
    );
}


// ========================================
// VIDEO METADATA
// ========================================

async function getVideoMetadata(
    filePath
) {

    const metadata =
        await probeVideo(
            filePath
        );


    const stats =
        await fs.promises.stat(
            filePath
        );


    return {

        width:
            metadata.width,

        height:
            metadata.height,

        duration:
            metadata.duration,

        sizeBytes:
            stats.size
    };
}


// ========================================
// VIDEO PREPARATION
// ========================================

async function processVideoFile(
    inputPath,
    reelId,
    broadcast
) {

    updateReel(
        reelId,
        "Processing",
        "processing",
        0,
        "checking_video_format",
        broadcast
    );


    const info =
        await probeVideo(
            inputPath
        );


    console.log(
        "Input video information:",
        info
    );


    // ========================================
    // ALREADY COMPATIBLE
    // ========================================

    if (
        isCompatibleVideo(
            info
        )
    ) {

        console.log(
            "Video is already compatible."
        );


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


    // ========================================
    // PREPARE VIDEO
    // ========================================

    console.log(
        "Video requires preparation."
    );


    const preparedPath =
        path.join(
            downloadsDir,
            `${reelId}.prepared.mp4`
        );


    if (
        fs.existsSync(
            preparedPath
        )
    ) {

        await fs.promises.unlink(
            preparedPath
        );
    }


    updateReel(
        reelId,
        "Processing",
        "processing",
        10,
        "processing_video",
        broadcast
    );


    await prepareVideo(
        inputPath,
        preparedPath
    );


    updateReel(
        reelId,
        "Processing",
        "processing",
        90,
        "verifying_prepared_video",
        broadcast
    );


    if (
        !fs.existsSync(
            preparedPath
        )
    ) {

        throw new Error(
            "Prepared video was not created."
        );
    }


    const preparedInfo =
        await probeVideo(
            preparedPath
        );


    console.log(
        "Prepared video information:",
        preparedInfo
    );


    if (
        !isCompatibleVideo(
            preparedInfo
        )
    ) {

        throw new Error(
            "Prepared video failed compatibility verification."
        );
    }


    console.log(
        "Prepared video verified successfully."
    );


    await fs.promises.unlink(
        inputPath
    );


    console.log(
        "Original video deleted after verification."
    );


    await fs.promises.rename(
        preparedPath,
        inputPath
    );


    console.log(
        "Prepared video moved to final path."
    );


    return inputPath;
}


// ========================================
// AUTO CLEANUP AFTER SUCCESSFUL PUBLISH
// ========================================

async function cleanupPublishedReel(
    reelId,
    cloudinaryPublicId
) {

    console.log(
        `\nStarting automatic cleanup for reel ${reelId}...`
    );


    // ========================================
    // DELETE CLOUDINARY COPY
    // ========================================

    if (
        cloudinaryPublicId
    ) {

        try {

            await deleteVideo(
                cloudinaryPublicId
            );

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

        console.log(
            "No Cloudinary public ID available."
        );
    }


    // ========================================
    // DELETE LOCAL PC VIDEO
    // ========================================

    const outputFile =
        getOutputFile(
            reelId
        );


    if (
        fs.existsSync(
            outputFile
        )
    ) {

        try {

            await fs.promises.unlink(
                outputFile
            );

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

function saveCaption(
    reelId,
    caption
) {

    const reels =
        loadReels();


    const reel =
        reels.find(
            item =>
                item.id === reelId
        );


    if (!reel) {

        throw new Error(
            "Reel not found while saving caption."
        );
    }


    reel.caption =
        typeof caption === "string"
            ? caption
            : "";


    saveReels(
        reels
    );


    console.log(
        `[${reelId}] Original caption saved.`
    );
}


// ========================================
// MAIN PROCESSOR
// ========================================

async function processReel(
    reel,
    broadcast
) {

    console.log(
        "\n======================================"
    );

    console.log(
        "Processing reel with ID:",
        reel.id
    );

    console.log(
        "======================================\n"
    );


    try {

        // ========================================
        // QUEUED
        // ========================================

        updateReel(
            reel.id,
            "Queued",
            "queued",
            0,
            "keyword_added_to_queue",
            broadcast
        );


        // ========================================
        // DOWNLOADING
        // ========================================

        updateReel(
            reel.id,
            "Downloading",
            "downloading",
            0,
            "initializing_download",
            broadcast
        );


        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    250
                )
        );


        updateReel(
            reel.id,
            "Downloading",
            "downloading",
            0,
            "fetching_media",
            broadcast
        );


        const result =
            await downloadMedia(

                reel.url,

                reel.id,

                (downloadProgress) => {

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


        console.log(
            "Download completed:",
            result.filePath
        );


        // ========================================
        // SAVE ORIGINAL CAPTION
        // ========================================

        saveCaption(
            reel.id,
            result.caption
        );


        updateReel(
            reel.id,
            "Downloading",
            "downloading",
            100,
            "download_completed",
            broadcast
        );


        // ========================================
        // CHECK DOWNLOADED FILE
        // ========================================

        updateReel(
            reel.id,
            "Processing",
            "processing",
            0,
            "checking_download",
            broadcast
        );


        const outputFile =
            getOutputFile(
                reel.id
            );


        if (
            !fs.existsSync(
                outputFile
            )
        ) {

            throw new Error(
                "Downloaded video file was not found."
            );
        }


        // ========================================
        // PROCESSING
        // ========================================

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    250
                )
        );


        await runWithSmoothProgress(

            reel.id,

            "Processing",

            "processing",

            "processing_video",

            () =>
                processVideoFile(
                    outputFile,
                    reel.id,
                    broadcast
                ),

            broadcast,

            350
        );


        // ========================================
        // FINAL METADATA
        // ========================================

        const metadata =
            await getVideoMetadata(
                outputFile
            );


        console.log(
            "Final video metadata:",
            metadata
        );


        const reels =
            loadReels();


        const currentReel =
            reels.find(
                item =>
                    item.id === reel.id
            );


        if (currentReel) {

            currentReel.width =
                metadata.width;

            currentReel.height =
                metadata.height;

            currentReel.duration =
                metadata.duration;

            currentReel.sizeBytes =
                metadata.sizeBytes;


            saveReels(
                reels
            );
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

        const cloudinaryResult =
            await runWithSmoothProgress(

                reel.id,

                "Cloud Uploading",

                "uploading",

                "uploading_to_cloudinary",

                () =>
                    uploadVideo(
                        outputFile,
                        reel.id
                    ),

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


        // ========================================
        // GET SAVED ORIGINAL CAPTION
        // ========================================

        const captionReels =
            loadReels();


        const captionReel =
            captionReels.find(
                item =>
                    item.id === reel.id
            );


        const originalCaption =
            captionReel?.caption || "";


        console.log(
            "\nOriginal caption to publish:"
        );

        console.log(
            originalCaption
        );


        // ========================================
        // INSTAGRAM PUBLISHING
        // ========================================

        const instagramResult =
            await runWithSmoothProgress(

                reel.id,

                "Publishing",

                "publishing",

                "creating_instagram_container",

                () =>
                    publishInstagramReel(

                        cloudinaryResult.secureUrl,

                        originalCaption,

                        false

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


        // ========================================
        // SAVE FINAL INFORMATION
        // ========================================

        const updatedReels =
            loadReels();


        const publishedReel =
            updatedReels.find(
                item =>
                    item.id === reel.id
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

            publishedReel.status =
                "published";

            publishedReel.stage =
                "Published";

            publishedReel.progress =
                100;

            publishedReel.detail =
                "instagram_publish_complete";

            publishedReel.publishedAt =
                new Date().toISOString();


            saveReels(
                updatedReels
            );
        }


        // ========================================
        // FINAL BROADCAST
        // ========================================

        if (broadcast) {

            broadcast({

                type:
                    "reel_update",

                id:
                    reel.id,

                stage:
                    "Published",

                status:
                    "published",

                progress:
                    100,

                detail:
                    "instagram_publish_complete"
            });
        }


        console.log(
            "\n======================================"
        );

        console.log(
            `SIFT: Reel ${reel.id} published successfully.`
        );

        console.log(
            "======================================\n"
        );


        // ========================================
        // AUTO CLEANUP
        // ========================================

        await cleanupPublishedReel(

            reel.id,

            cloudinaryResult.publicId
        );


    } catch (error) {

        console.error(
            "\nProcessing failed:"
        );

        console.error(
            error
        );


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

function verifyDownloadedFile(
    reel,
    broadcast
) {

    if (
        reel.status !==
        "downloaded"
    ) {

        return;
    }


    const outputFile =
        getOutputFile(
            reel.id
        );


    if (
        !fs.existsSync(
            outputFile
        )
    ) {

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