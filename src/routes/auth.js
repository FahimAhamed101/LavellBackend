const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  updateLocation,
  refreshAccessToken,
  logout,
  logoutAll,
  getBankInformation,
  saveBankInformation,
  updateBankInformation,
  getRecentProviders
} = require('../controllers/authController');
const { requestPasswordReset, verifyOTP, resetPassword } = require('../controllers/passwordResetController');
const {
  requestRegistrationOTP,
  verifyRegistrationOTP,
  completeRegistration
} = require('../controllers/registrationOTPController');
const auth = require('../middleware/auth');
const { uploadProfilePicture, handleUploadError } = require('../middleware/upload');

// Public routes - Authentication
router.post('/register', register);
router.post('/login', login);
router.post('/refresh-token', refreshAccessToken);
router.post('/logout', logout);

// Public routes - Registration OTP
router.post('/register/request-otp', requestRegistrationOTP);
router.post('/register/verify-otp', verifyRegistrationOTP);
router.post('/register/complete', completeRegistration);

// Public routes - Password Reset
router.post('/forgot-password', requestPasswordReset);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

// Protected routes
router.get('/me', auth, getMe);
router.put('/me', auth, uploadProfilePicture, handleUploadError, updateProfile);
router.post('/change-password', auth, changePassword);
router.post('/update-location', auth, updateLocation);
router.post('/logout-all', auth, logoutAll);
router.get('/bank-information', auth, getBankInformation);
router.post('/bank-information', auth, saveBankInformation);
router.put('/bank-information', auth, updateBankInformation);
router.get('/recent-providers', auth, getRecentProviders);

module.exports = router;
