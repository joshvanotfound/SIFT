const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const downloadsDir =
    path.join(__dirname, "downloads");

if (!fs.existsSync(downloadsDir)) {

    fs.mkdirSync(
        downloadsDir,
        { recursive: true }
    );
}


// ========================================
// GET SOURCE CAPTION
// ========================================

function getSourceCaption(url) {

    return new Promise((resolve, reject) => {

        console.log(
            "Reading original caption..."
        );

        const args = [
            "--no-playlist",
            "--skip-download",
            "--dump-single-json",
            url
        ];

        execFile(
            "yt-dlp",
            args,
            {
                maxBuffer: 20 * 1024 * 1024
            },
            (error, stdout, stderr) => {

                if (error) {

                    console.error(
                        "Failed to read source caption:"
                    );

                    console.error(
                        stderr
                    );

                    reject(error);

                    return;
                }

                try {

                    const info =
                        JSON.parse(
                            stdout
                        );

                    const caption =
                        typeof info.description ===
                        "string"
                            ? info.description
                            : "";

                    console.log(
                        "Original caption collected."
                    );

                    resolve(
                        caption
                    );

                } catch (parseError) {

                    console.error(
                        "Failed to parse yt-dlp metadata:"
                    );

                    console.error(
                        parseError
                    );

                    reject(
                        parseError
                    );
                }
            }
        );
    });
}


// ========================================
// DOWNLOAD MEDIA
// ========================================

function downloadMedia(
    url,
    reelId,
    onProgress
) {

    return new Promise(
        async (resolve, reject) => {

            try {

                /*
                ========================================
                GET ORIGINAL CAPTION FIRST
                ========================================
                */

                const caption =
                    await getSourceCaption(
                        url
                    );


                /*
                ========================================
                DOWNLOAD VIDEO
                ========================================
                */

                const outputTemplate =
                    path.join(
                        downloadsDir,
                        `${reelId}.%(ext)s`
                    );


                console.log(
                    "Starting media download:",
                    url
                );


                const args = [

                    "--ffmpeg-location",
                    "C:\\ffmpeg\\bin",

                    "--no-playlist",

                    "--newline",

                    "-f",
                    "bv*+ba/b",

                    "--merge-output-format",
                    "mp4",

                    "-o",
                    outputTemplate,

                    url
                ];


                const process =
                    execFile(
                        "yt-dlp",
                        args,
                        {
                            maxBuffer:
                                20 * 1024 * 1024
                        },
                        (
                            error,
                            stdout,
                            stderr
                        ) => {

                            if (error) {

                                console.error(
                                    "Download failed:"
                                );

                                console.error(
                                    stderr
                                );

                                reject(
                                    error
                                );

                                return;
                            }


                            console.log(
                                stdout
                            );


                            const outputFile =
                                path.join(
                                    downloadsDir,
                                    `${reelId}.mp4`
                                );


                            resolve({

                                success:
                                    true,

                                filePath:
                                    outputFile,

                                caption:
                                    caption
                            });
                        }
                    );


                /*
                ========================================
                DOWNLOAD PROGRESS
                ========================================
                */

                let highestProgress = 0;


                function handleOutput(
                    data
                ) {

                    const text =
                        data.toString();


                    console.log(
                        "[yt-dlp]",
                        text.trim()
                    );


                    const matches =
                        text.match(
                            /(\d+(?:\.\d+)?)%/g
                        );


                    if (
                        !matches ||
                        matches.length === 0
                    ) {

                        return;
                    }


                    const lastMatch =
                        matches[
                            matches.length - 1
                        ];


                    const percentage =
                        parseFloat(
                            lastMatch.replace(
                                "%",
                                ""
                            )
                        );


                    if (
                        !Number.isFinite(
                            percentage
                        ) ||
                        !onProgress
                    ) {

                        return;
                    }


                    const currentProgress =
                        Math.min(
                            100,
                            Math.max(
                                0,
                                Math.round(
                                    percentage
                                )
                            )
                        );


                    /*
                     * yt-dlp may download multiple
                     * streams.
                     *
                     * Never allow progress to move
                     * backwards.
                     */

                    if (
                        currentProgress >
                        highestProgress
                    ) {

                        highestProgress =
                            currentProgress;

                        onProgress(
                            highestProgress
                        );
                    }
                }


                process.stdout?.on(
                    "data",
                    handleOutput
                );


                process.stderr?.on(
                    "data",
                    handleOutput
                );

            } catch (error) {

                reject(error);
            }
        }
    );
}


module.exports = {
    downloadMedia,
    getSourceCaption
};