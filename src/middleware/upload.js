const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
const idCardsDir = path.join(uploadsDir, 'id-cards');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(idCardsDir)) {
  fs.mkdirSync(idCardsDir, { recursive: true });
}

// Configure storage for ID cards
const idCardStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, idCardsDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: timestamp-randomstring-originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    cb(null, `${nameWithoutExt}-${uniqueSuffix}${ext}`);
  }
});

// Configure storage for profile pictures and service photos
const generalStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: timestamp-randomstring-originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    cb(null, `${nameWithoutExt}-${uniqueSuffix}${ext}`);
  }
});

// File filter to accept only images
const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'), false);
  }
};

// Configure multer for ID cards
const idCardUpload = multer({
  storage: idCardStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  }
});

// Configure multer for general uploads (profile pictures, service photos)
const generalUpload = multer({
  storage: generalStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  }
});

// Middleware for ID card uploads (front required, back optional)
const uploadIdCards = idCardUpload.fields([
  { name: 'idCardFront', maxCount: 1 },    // Required
  { name: 'idCardBack', maxCount: 1 }      // Optional - for records only
]);

// Middleware for business owner registration (ID cards + business photo)
const uploadBusinessOwnerFiles = idCardUpload.fields([
  { name: 'idCardFront', maxCount: 1 },
  { name: 'idCardBack', maxCount: 1 },
  { name: 'businessPhoto', maxCount: 1 }
]);

// Middleware for business profile update (cover photo + multiple business photos)
const uploadBusinessProfileFiles = generalUpload.fields([
  { name: 'coverPhoto', maxCount: 1 },
  { name: 'businessPhotos', maxCount: 10 } // Allow up to 10 business photos
]);

// Middleware for event manager registration (ID cards only)
const uploadEventManagerFiles = idCardUpload.fields([
  { name: 'idCardFront', maxCount: 1 },
  { name: 'idCardBack', maxCount: 1 }
]);

// Middleware for single profile picture upload
const uploadProfilePicture = generalUpload.single('profilePicture');

// Middleware for single service photo upload
const uploadServicePhoto = generalUpload.single('servicePhoto');

// Middleware for portfolio images (before and after)
const uploadPortfolioImages = generalUpload.fields([
  { name: 'beforeImage', maxCount: 1 },
  { name: 'afterImage', maxCount: 1 }
]);

// Middleware for single category icon upload
const uploadCategoryIcon = generalUpload.single('icon');

// Middleware for single event image upload
const uploadEventImage = generalUpload.single('eventImage');

// Middleware for employee service photo upload
const uploadEmployeeServicePhoto = generalUpload.single('servicePhoto');

// Middleware for employee profile + service photo upload
const uploadEmployeeFiles = generalUpload.fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'servicePhoto', maxCount: 1 }
]);

// Middleware for bank verification document upload
const uploadBankVerificationDocument = generalUpload.single('bankVerificationDocument');

// Error handler middleware for multer
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size is too large. Maximum size is 5MB.'
      });
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: `Unexpected field in file upload. Expected fields: 'idCardFront' and 'idCardBack'. Got unexpected field: '${err.field}'`
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message
    });
  } else if (err) {
    // Other errors
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  next();
};

module.exports = {
  uploadIdCards,
  uploadBusinessOwnerFiles,
  uploadEventManagerFiles,
  uploadProfilePicture,
  uploadServicePhoto,
  uploadPortfolioImages,
  uploadCategoryIcon,
  uploadEventImage,
  uploadEmployeeServicePhoto,
  uploadEmployeeFiles,
  uploadBusinessProfileFiles,
  uploadBankVerificationDocument,
  handleUploadError
};
