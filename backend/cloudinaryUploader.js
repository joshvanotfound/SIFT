const cloudinary = require("cloudinary").v2;


// ========================================
// CLOUDINARY CONFIG
// ========================================

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});


// ========================================
// UPLOAD VIDEO
// ========================================

async function uploadVideo(filePath, reelId) {

    console.log(
        `Uploading reel ${reelId} to Cloudinary...`
    );

    const result = await cloudinary.uploader.upload(
        filePath,
        {
            resource_type: "video",
            public_id: `sift/reels/${reelId}`,
            overwrite: true
        }
    );

    console.log(
        `Cloudinary upload completed for reel ${reelId}`
    );

    console.log(
        "Cloudinary URL:",
        result.secure_url
    );

    return {
        publicId: result.public_id,
        secureUrl: result.secure_url,
        resourceType: result.resource_type,
        bytes: result.bytes,
        duration: result.duration
    };
}


// ========================================
// DELETE VIDEO
// ========================================

async function deleteVideo(publicId) {

    console.log(
        `Deleting Cloudinary video: ${publicId}`
    );

    const result =
        await cloudinary.uploader.destroy(
            publicId,
            {
                resource_type: "video"
            }
        );

    console.log(
        "Cloudinary deletion result:",
        result
    );

    return result;
}


// ========================================
// EXPORTS
// ========================================

module.exports = {
    uploadVideo,
    deleteVideo
};