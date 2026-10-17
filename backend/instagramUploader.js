const https = require("https");

const IG_USER_ID = process.env.INSTAGRAM_USER_ID;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const API_VERSION = "v25.0";

// ========================================
// HTTPS REQUEST HELPER
// ========================================

function request(method, url) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method }, (res) => {
            let data = "";

            res.on("data", chunk => {
                data += chunk.toString();
            });

            res.on("end", () => {
                let result;

                try {
                    result = JSON.parse(data);
                } catch {
                    const error = new Error(
                        `Instagram returned invalid JSON. HTTP ${res.statusCode}`
                    );

                    error.statusCode = res.statusCode;
                    reject(error);
                    return;
                }

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(result);
                    return;
                }

                const error = new Error(
                    result.error?.message || JSON.stringify(result)
                );

                error.statusCode = res.statusCode;
                error.response = result;
                reject(error);
            });
        });

        req.setTimeout(30000, () => {
            const error = new Error("Instagram request timed out.");
            req.destroy(error);
        });

        req.on("error", reject);
        req.end();
    });
}

// ========================================
// CREATE REEL CONTAINER
// ========================================

async function createReelContainer(
    videoUrl,
    caption = "",
    shareToFeed = false
) {
    console.log("\nCreating Instagram Reel container...");

    const params = new URLSearchParams({
        media_type: "REELS",
        video_url: videoUrl,
        caption,
        share_to_feed: String(shareToFeed),
        access_token: ACCESS_TOKEN
    });

    const url =
        `https://graph.instagram.com/${API_VERSION}` +
        `/${IG_USER_ID}/media?${params.toString()}`;

    const result = await request("POST", url);

    if (!result.id) {
        throw new Error(
            "Instagram did not return a container ID. Publishing was not started."
        );
    }

    console.log("Instagram container created:", result.id);
    return result.id;
}

// ========================================
// CHECK CONTAINER STATUS
// ========================================

async function getContainerStatus(containerId) {
    const params = new URLSearchParams({
        fields: "status_code,status",
        access_token: ACCESS_TOKEN
    });

    const url =
        `https://graph.instagram.com/${API_VERSION}` +
        `/${containerId}?${params.toString()}`;

    return request("GET", url);
}

// ========================================
// WAIT FOR CONTAINER
// ========================================

async function waitForContainer(containerId) {
    console.log("Waiting for Instagram container...");

    const maxAttempts = 60;
    const delayMs = 5000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await getContainerStatus(containerId);

        console.log(
            `Instagram status ${attempt}/${maxAttempts}:`,
            result.status_code,
            result.status || ""
        );

        if (result.status_code === "FINISHED") {
            return result;
        }

        if (
            result.status_code === "ERROR" ||
            result.status_code === "EXPIRED"
        ) {
            throw new Error(
                `Instagram container ${result.status_code}: ` +
                (result.status || "Container processing failed.")
            );
        }

        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    throw new Error("Instagram container timed out.");
}

// ========================================
// PUBLISH REEL
// ========================================

async function publishReel(containerId) {
    console.log("\nPublishing Instagram Reel...");

    const params = new URLSearchParams({
        creation_id: containerId,
        access_token: ACCESS_TOKEN
    });

    const url =
        `https://graph.instagram.com/${API_VERSION}` +
        `/${IG_USER_ID}/media_publish?${params.toString()}`;

    try {
        const result = await request("POST", url);

        if (!result.id) {
            throw new Error(
                "Instagram did not return a Media ID."
            );
        }

        console.log("Instagram Reel published:", result.id);
        return result.id;
    } catch (error) {
        // The publish request may have reached Instagram even if
        // the response was lost or returned an error.
        // Never automatically retry this operation.
        error.uncertain = true;
        error.containerId = containerId;
        throw error;
    }
}

// ========================================
// FULL REEL PUBLISH FLOW
// ========================================

async function publishInstagramReel(
    videoUrl,
    caption = "",
    shareToFeed = false,
    onContainerCreated = null,
    beforePublish = null
) {
    const containerId = await createReelContainer(
        videoUrl,
        caption,
        shareToFeed
    );

    // Persist the container ID before proceeding.
    // If saving fails, do not attempt media_publish.
    if (onContainerCreated) {
        try {
            await onContainerCreated(containerId);
        } catch (error) {
            error.containerId = containerId;
            error.uncertain = false;
            error.message =
                "Container created, but saving its ID failed. " +
                "Publishing was stopped. " + error.message;

            throw error;
        }
    }

    await waitForContainer(containerId);

    // Persist a safety marker before sending the publish request.
    // If saving fails, stop without attempting to publish.
    if (beforePublish) {
        try {
            await beforePublish(containerId);
        } catch (error) {
            error.containerId = containerId;
            error.uncertain = false;
            error.message =
                "Could not save the Instagram publish safety marker. " +
                "Publishing was stopped. " + error.message;

            throw error;
        }
    }

    try {
        const mediaId = await publishReel(containerId);

        return { containerId, mediaId };
    } catch (error) {
        error.containerId = containerId;
        error.uncertain = true;
        error.message =
            "Instagram publishing has no confirmed result. " +
            "Check the Instagram account before deciding whether " +
            "to retry. " + error.message;

        throw error;
    }
}

// ========================================
// GET PUBLISHED MEDIA BY ID
// ========================================

async function getPublishedMedia(mediaId) {
    const params = new URLSearchParams({
        fields: "id",
        access_token: ACCESS_TOKEN
    });

    const url =
        `https://graph.instagram.com/${API_VERSION}` +
        `/${mediaId}?${params.toString()}`;

    return request("GET", url);
}

// ========================================
// GET ACCOUNT MEDIA
// ========================================

async function getAccountMedia(afterCursor = null) {
    const params = new URLSearchParams({
        fields: "id,caption,timestamp,media_type",
        limit: "100",
        access_token: ACCESS_TOKEN
    });

    if (afterCursor) {
        params.set("after", afterCursor);
    }

    const url =
        `https://graph.instagram.com/${API_VERSION}` +
        `/${IG_USER_ID}/media?${params.toString()}`;

    return request("GET", url);
}

// ========================================
// GET ALL ACCOUNT MEDIA PAGES
// ========================================

async function getAllAccountMedia() {
    const allMedia = [];
    let afterCursor = null;

    while (true) {
        const result = await getAccountMedia(afterCursor);
        const media = Array.isArray(result.data) ? result.data : [];

        allMedia.push(...media);

        const nextCursor = result.paging?.cursors?.after;
        const hasNextPage = Boolean(result.paging?.next && nextCursor);

        if (!hasNextPage) {
            return allMedia;
        }

        afterCursor = nextCursor;
    }
}

// ========================================
// CHECK IF PUBLISHED MEDIA EXISTS
// ========================================

async function isPublishedMediaPresent(mediaId) {
    let afterCursor = null;

    while (true) {
        const result = await getAccountMedia(afterCursor);
        const media = Array.isArray(result.data) ? result.data : [];

        if (media.some(item => item.id === mediaId)) {
            return true;
        }

        const nextCursor = result.paging?.cursors?.after;
        const hasNextPage = Boolean(result.paging?.next && nextCursor);

        if (!hasNextPage) {
            return false;
        }

        afterCursor = nextCursor;
    }
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
    createReelContainer,
    getContainerStatus,
    waitForContainer,
    publishReel,
    publishInstagramReel,
    getPublishedMedia,
    getAccountMedia,
    getAllAccountMedia,
    isPublishedMediaPresent
};