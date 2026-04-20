const cloudinary = require('cloudinary').v2;

// Configure Cloudinary with environment variables
const configureCloudinary = () => {
  const config = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  };

  cloudinary.config(config);

  // Debug log
  console.log('Cloudinary configured with cloud_name:', config.cloud_name);

  return config;
};

/**
 * Upload image to Cloudinary
 * @param {String} filePath - Path to the file or base64 string
 * @param {String} folder - Folder name in Cloudinary (e.g., 'services', 'profiles')
 * @returns {Promise} - Cloudinary upload response
 */
const uploadToCloudinary = async (filePath, folder = 'services') => {
  try {
    // Ensure Cloudinary is configured
    configureCloudinary();

    const options = {
      folder: `lavellh/${folder}`,
      resource_type: 'auto',
      transformation: [
        { width: 1200, height: 800, crop: 'limit' },
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ]
    };

    console.log('Uploading file:', filePath);
    const result = await cloudinary.uploader.upload(filePath, options);

    console.log('Upload successful:', result.secure_url);

    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Delete image from Cloudinary
 * @param {String} publicId - Public ID of the image to delete
 * @returns {Promise} - Cloudinary delete response
 */
const deleteFromCloudinary = async (publicId) => {
  try {
    // Ensure Cloudinary is configured
    configureCloudinary();

    const result = await cloudinary.uploader.destroy(publicId);
    return {
      success: true,
      result
    };
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  cloudinary
};
