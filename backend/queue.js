const fs = require("fs");
const path = require("path");

const queueFile =
    path.join(
        __dirname,
        "reels.json"
    );


// ========================================
// LOAD REELS
// ========================================

function loadReels() {

    try {

        if (
            !fs.existsSync(
                queueFile
            )
        ) {

            fs.writeFileSync(
                queueFile,
                "[]"
            );
        }


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


// ========================================
// SAVE REELS
// ========================================

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
// ADD REEL
// ========================================

function addReel(
    url
) {

    const reels =
        loadReels();


    const reel = {

        id:
            Date.now().toString(),

        url:
            url,

        // ========================================
        // ORIGINAL SOURCE CAPTION
        // ========================================

        caption:
            "",

        // ========================================
        // PROCESSING INFORMATION
        // ========================================

        stage:
            "Queued",

        status:
            "queued",

        progress:
            0,

        createdAt:
            new Date().toISOString()
    };


    reels.push(
        reel
    );


    saveReels(
        reels
    );


    return reel;
}


// ========================================
// GET REELS
// ========================================

function getReels() {

    return loadReels();
}


// ========================================
// EXPORTS
// ========================================

module.exports = {

    addReel,

    getReels
};