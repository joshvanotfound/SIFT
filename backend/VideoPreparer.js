const { spawn } = require("child_process");
const FFMPEG_PATH =
    process.env.FFMPEG_PATH || "C:\\ffmpeg\\bin\\ffmpeg.exe";
const FFPROBE_PATH =
    process.env.FFPROBE_PATH || "C:\\ffmpeg\\bin\\ffprobe.exe";
// ------------------------------------
// Probe video information
// ------------------------------------
function probeVideo(inputPath) {
    return new Promise((resolve, reject) => {
        const args = [
            "-v", "error",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            inputPath
        ];
        const ffprobe = spawn(FFPROBE_PATH, args);
        let output = "";
        let errorOutput = "";
        ffprobe.stdout.on("data", (data) => {
            output += data.toString();
        });
        ffprobe.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });
        ffprobe.on("close", (code) => {
            if (code !== 0) {
                reject(
                    new Error(
                        `FFprobe failed with code ${code}: ${errorOutput}`
                    )
                );
                return;
            }
            try {
                const data = JSON.parse(output);
                const videoStream = data.streams?.find(
                    (stream) => stream.codec_type === "video"
                );
                const audioStream = data.streams?.find(
                    (stream) => stream.codec_type === "audio"
                );
                resolve({
                    duration: data.format?.duration
                        ? Number(data.format.duration)
                        : null,
                    width: videoStream?.width ?? null,
                    height: videoStream?.height ?? null,
                    videoCodec: videoStream?.codec_name ?? null,
                    pixelFormat: videoStream?.pix_fmt ?? null,
                    frameRate: videoStream?.avg_frame_rate ?? null,
                    audioCodec: audioStream?.codec_name ?? null,
                    audioSampleRate: audioStream?.sample_rate
                        ? Number(audioStream.sample_rate)
                        : null,
                    audioChannels: audioStream?.channels ?? null,
                    format: data.format?.format_name ?? null
                });
            } catch (error) {
                reject(
                    new Error(
                        `Could not parse FFprobe output: ${error.message}`
                    )
                );
            }
        });
        ffprobe.on("error", (error) => {
            reject(error);
        });
    });
}
// ------------------------------------
// Check if video already matches
// our SIFT prepared-video format
// ------------------------------------
function isCompatibleVideo(info) {
    return (
        info.width === 1080 &&
        info.height === 1920 &&
        info.videoCodec === "h264" &&
        info.pixelFormat === "yuv420p" &&
        info.audioCodec === "aac" &&
        info.audioSampleRate === 44100 &&
        info.audioChannels === 2 &&
        typeof info.frameRate === "string" &&
        info.frameRate !== "0/0"
    );
}
// ------------------------------------
// Prepare video when necessary
// ------------------------------------
async function prepareVideo(inputPath, outputPath) {
    const info = await probeVideo(inputPath);
    if (isCompatibleVideo(info)) {
        console.log(
            "Video is already compatible. Skipping preparation."
        );
        return inputPath;
    }
    console.log(
        "Video needs preparation. Starting FFmpeg..."
    );
    return new Promise((resolve, reject) => {
        const args = [
            "-y",
            "-i", inputPath,
            // --------------------------------
            // 9:16 canvas
            // Preserve entire source.
            // No crop.
            // No stretching.
            // --------------------------------
            "-vf",
            "scale=1080:1920:force_original_aspect_ratio=decrease," +
            "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black," +
            "setsar=1",
            // --------------------------------
            // Video
            // --------------------------------
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "20",
            "-profile:v", "high",
            "-pix_fmt", "yuv420p",
            // --------------------------------
            // Audio
            // --------------------------------
            "-c:a", "aac",
            "-b:a", "192k",
            "-ar", "44100",
            "-ac", "2",
            // --------------------------------
            // MP4 optimized for upload
            // --------------------------------
            "-movflags", "+faststart",
            outputPath
        ];
        const ffmpeg = spawn(FFMPEG_PATH, args);
        let errorOutput = "";
        ffmpeg.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });
        ffmpeg.on("close", (code) => {
            if (code === 0) {
                console.log(
                    "Video preparation completed."
                );
                resolve(outputPath);
            } else {
                reject(
                    new Error(
                        `FFmpeg failed with code ${code}: ${errorOutput}`
                    )
                );
            }
        });
        ffmpeg.on("error", (error) => {
            reject(error);
        });
    });
}
// ------------------------------------
// Exports
// ------------------------------------
module.exports = {
    probeVideo,
    isCompatibleVideo,
    prepareVideo
};
// ------------------------------------
// Temporary manual test mode
// ------------------------------------
if (require.main === module) {
    const testVideo = process.argv[2];
    if (!testVideo) {
        console.log(
            "Usage: node videoPreparer.js <video-path>"
        );
        process.exit(1);
    }
    probeVideo(testVideo)
        .then((info) => {
            console.log("\nVideo information:");
            console.log(info);
            console.log(
                "\nCompatible:",
                isCompatibleVideo(info)
            );
        })
        .catch((error) => {
            console.error("\nProbe failed:");
            console.error(error.message);
            process.exit(1);
        });
}