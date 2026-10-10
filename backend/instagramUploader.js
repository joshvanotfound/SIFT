const https = require("https");

const IG_USER_ID =
    process.env.INSTAGRAM_USER_ID;

const ACCESS_TOKEN =
    process.env.INSTAGRAM_ACCESS_TOKEN;

const API_VERSION = "v25.0";


// ========================================
// HTTPS REQUEST HELPER
// ========================================

function request(method, url) {

    return new Promise((resolve, reject) => {

        const req = https.request(
            url,
            {
                method: method
            },
            (res) => {

                let data = "";

                res.on("data", (chunk) => {
                    data += chunk.toString();
                });

                res.on("end", () => {

                    try {

                        const result =
                            JSON.parse(data);

                        if (
                            res.statusCode >= 200 &&
                            res.statusCode < 300
                        ) {

                            resolve(result);

                        } else {

                            reject(
                                new Error(
                                    JSON.stringify(result)
                                )
                            );
                        }

                    } catch (error) {

                        reject(
                            new Error(
                                `Instagram returned invalid JSON: ${data}`
                            )
                        );
                    }
                });
            }
        );

        req.on("error", (error) => {
            reject(error);
        });

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

    console.log(
        "\nCreating Instagram Reel container..."
    );

    const params = new URLSearchParams({

        media_type: "REELS",

        video_url: videoUrl,

        caption: caption,

        share_to_feed:
            String(shareToFeed),

        access_token: ACCESS_TOKEN
    });

    const url =
        `https://graph.instagram.com/${API_VERSION}` +
        `/${IG_USER_ID}/media?${params.toString()}`;

    const result =
        await request("POST", url);

    if (!result.id) {

        throw new Error(
            "Instagram did not return a container ID."
        );
    }

    console.log(
        "Instagram container created:",
        result.id
    );

    return result.id;
}


// ========================================
// CHECK CONTAINER STATUS
// ========================================

async function getContainerStatus(
    containerId
) {

    const params = new URLSearchParams({

        fields: "status_code,status",

        access_token: ACCESS_TOKEN
    });

    const url =
        `https://graph.instagram.com/${API_VERSION}` +
        `/${containerId}?${params.toString()}`;

    return await request(
        "GET",
        url
    );
}


// ========================================
// WAIT FOR CONTAINER
// ========================================

async function waitForContainer(
    containerId
) {

    console.log(
        "Waiting for Instagram container..."
    );

    const maxAttempts = 60;

    const delayMs = 5000;

    for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
    ) {

        const status =
            await getContainerStatus(
                containerId
            );

        console.log(
            `Instagram status ${attempt}/${maxAttempts}:`,
            status.status_code,
            status.status || ""
        );

        if (
            status.status_code ===
            "FINISHED"
        ) {

            return status;
        }

        if (
            status.status_code ===
            "ERROR"
        ) {

            throw new Error(
                `Instagram container failed: ${
                    status.status || "Unknown error"
                }`
            );
        }

        if (
            status.status_code ===
            "EXPIRED"
        ) {

            throw new Error(
                "Instagram container expired."
            );
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    delayMs
                )
        );
    }

    throw new Error(
        "Instagram container timed out."
    );
}


// ========================================
// PUBLISH REEL
// ========================================

async function publishReel(
    containerId
) {

    console.log(
        "\nPublishing Instagram Reel..."
    );

    const params = new URLSearchParams({

        creation_id: containerId,

        access_token: ACCESS_TOKEN
    });

    const url =
        `https://graph.instagram.com/${API_VERSION}` +
        `/${IG_USER_ID}/media_publish?${params.toString()}`;

    const result =
        await request("POST", url);

    if (!result.id) {

        throw new Error(
            "Instagram did not return a Media ID."
        );
    }

    console.log(
        "Instagram Reel published:",
        result.id
    );

    return result.id;
}


// ========================================
// FULL REEL PUBLISH FLOW
// ========================================

async function publishInstagramReel(
    videoUrl,
    caption = "",
    shareToFeed = false
) {

    const containerId =
        await createReelContainer(
            videoUrl,
            caption,
            shareToFeed
        );

    await waitForContainer(
        containerId
    );

    const mediaId =
        await publishReel(
            containerId
        );

    return {
        containerId,
        mediaId
    };
}


// ========================================
// GET PUBLISHED MEDIA BY ID
// ========================================
//
// Kept here so the current server.js
// does not crash while we transition
// the deletion checker.
//

async function getPublishedMedia(
    mediaId
) {

    const params = new URLSearchParams({

        fields: "id",

        access_token: ACCESS_TOKEN
    });

    const url =
        `https://graph.instagram.com/${API_VERSION}` +
        `/${mediaId}?${params.toString()}`;

    return await request(
        "GET",
        url
    );
}


// ========================================
// GET ACCOUNT MEDIA
// ========================================

async function getAccountMedia(
    afterCursor = null
) {

    const params = new URLSearchParams({

        fields: "id",

        limit: "100",

        access_token: ACCESS_TOKEN
    });

    if (afterCursor) {

        params.set(
            "after",
            afterCursor
        );
    }

    const url =
        `https://graph.instagram.com/${API_VERSION}` +
        `/${IG_USER_ID}/media?${params.toString()}`;

    return await request(
        "GET",
        url
    );
}


// ========================================
// CHECK IF PUBLISHED MEDIA EXISTS
// ========================================

async function isPublishedMediaPresent(
    mediaId
) {

    let afterCursor = null;

    while (true) {

        const result =
            await getAccountMedia(
                afterCursor
            );

        const media =
            Array.isArray(result.data)
                ? result.data
                : [];

        console.log(
            "Instagram media IDs:",
             media.map(item => item.id)
        );

        console.log(
             "Looking for media ID:",
              mediaId
        );

        const found =
            media.some(
                item =>
                    item.id === mediaId
            );

        if (found) {

            return true;
        }

        const nextCursor =
            result.paging?.cursors?.after;

        const hasNextPage =
            Boolean(
                result.paging?.next &&
                nextCursor
            );

        if (!hasNextPage) {

            return false;
        }

        afterCursor =
            nextCursor;
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

    isPublishedMediaPresent
};
