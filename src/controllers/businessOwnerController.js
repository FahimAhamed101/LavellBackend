const User = require('../models/User');
const BusinessOwner = require('../models/BusinessOwner');
const Employee = require('../models/Employee');
const EmployeeService = require('../models/EmployeeService');
const RefreshToken = require('../models/RefreshToken');
const BusinessOwnerRegistrationOTP = require('../models/BusinessOwnerRegistrationOTP');
const { getTokenExpiresIn } = require('../utility/jwt');
const { upsertDeviceToken } = require('../utility/deviceToken');
const fs = require('fs').promises;
const { uploadToCloudinary, deleteFromCloudinary } = require('../utility/cloudinary');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sendOTPEmail, sendRegistrationOTPEmail } = require('../utility/emailService');
const { sendRegistrationOTPSMS } = require('../utility/smsService');
const Settings = require('../models/Settings');
const Notification = require('../models/Notification');
const BusinessOwnerBooking = require('../models/BusinessOwnerBooking');
const BusinessOwnerAppointment = require('../models/BusinessOwnerAppointment');
const { buildImageUrl, buildImageUrls } = require('../utility/imageUrl');

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
const hashValue = (value) => crypto.createHash('sha256').update(value).digest('hex');

const getBusinessPinRank = (owner) => {
  const discoveryPin = owner?.discoveryPin;
  return {
    isPinned: discoveryPin?.isPinned === true,
    pinOrder: Number.isInteger(discoveryPin?.pinOrder) ? discoveryPin.pinOrder : Number.MAX_SAFE_INTEGER,
    pinnedAt: discoveryPin?.pinnedAt ? new Date(discoveryPin.pinnedAt).getTime() : Number.MAX_SAFE_INTEGER,
    fallbackId: String(owner?._id || '')
  };
};

const compareBusinessesByPinThenRating = (a, b) => {
  const rankA = getBusinessPinRank(a);
  const rankB = getBusinessPinRank(b);

  if (rankA.isPinned !== rankB.isPinned) {
    return rankA.isPinned ? -1 : 1;
  }

  if (rankA.isPinned && rankA.pinOrder !== rankB.pinOrder) {
    return rankA.pinOrder - rankB.pinOrder;
  }

  if (rankA.isPinned && rankA.pinnedAt !== rankB.pinnedAt) {
    return rankA.pinnedAt - rankB.pinnedAt;
  }

  if (a.businessRating !== b.businessRating) {
    return b.businessRating - a.businessRating;
  }

  return rankA.fallbackId.localeCompare(rankB.fallbackId);
};

const removeFileIfExists = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore cleanup errors
  }
};

const removeCloudinaryIfExists = async (publicId) => {
  if (!publicId) return;
  try {
    await deleteFromCloudinary(publicId);
  } catch (error) {
    // Ignore cleanup errors
  }
};

const removePendingBusinessOwnerAssets = async (pending) => {
  if (!pending) return;
  await removeCloudinaryIfExists(pending.businessPhotoPublicId);
  await removeCloudinaryIfExists(pending.idCardFrontPublicId);
  await removeCloudinaryIfExists(pending.idCardBackPublicId);
};

const createBusinessOwnerAndTokens = async (req, payload) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const user = new User({
      fullName: payload.fullName,
      email: payload.email || undefined,
      phoneNumber: payload.phoneNumber || undefined,
      password: payload.passwordHash,
      userType: 'businessOwner',
      authProvider: 'local',
      termsAccepted: true
    });

    await user.save({ session });

    const resolvedAddress = payload.businessAddress?.fullAddress || payload.businessAddress;

    const businessOwner = new BusinessOwner({
      userId: user._id,
      dateOfBirth: payload.dateOfBirth,
      businessName: payload.businessName,
      businessCategory: payload.businessCategory,
      businessAddress: resolvedAddress ? { fullAddress: resolvedAddress } : null,
      businessPhoto: payload.businessPhotoUrl || null,
      idCard: {
        frontImage: payload.idCardFrontUrl || null,
        backImage: payload.idCardBackUrl || null
      },
      occupation: payload.occupation || null,
      referenceId: payload.referenceId || null
    });

    await businessOwner.save({ session });

    await session.commitTransaction();

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    const refreshExpiresIn = getTokenExpiresIn('refresh');
    const expiresAt = new Date(Date.now() + refreshExpiresIn * 1000);

    const refreshTokenDoc = new RefreshToken({
      userId: user._id,
      token: crypto.createHash('sha256').update(refreshToken).digest('hex'),
      expiresAt,
      deviceInfo: {
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress
      }
    });

    await refreshTokenDoc.save();

    const accessExpiresIn = getTokenExpiresIn('access');

    return {
      user,
      businessOwner,
      accessToken,
      refreshToken,
      accessExpiresIn
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Register a new business owner
 * POST /api/business-owners/register
 */
exports.registerBusinessOwner = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phoneNumber,
      password,
      confirmPassword,
      occupation,
      referenceId,
      dateOfBirth,
      businessName,
      businessCategory,
      businessAddress,
    } = req.body;

    // Validate required fields
    if (!fullName || !password) {
      return res.status(400).json({
        success: false,
        message: 'Full name and password are required'
      });
    }

    if (!businessName || !businessCategory) {
      return res.status(400).json({
        success: false,
        message: 'Business name and business category are required'
      });
    }

    if (!businessAddress) {
      return res.status(400).json({
        success: false,
        message: 'Business address is required'
      });
    }

    // Validate email or phone number is provided
    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone number is required'
      });
    }

    // Validate password match
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Get ID card image paths
    const idCardFrontPath = req.files?.idCardFront ? req.files.idCardFront[0].path : null;
    const idCardBackPath = req.files?.idCardBack ? req.files.idCardBack[0].path : null;
    const businessPhotoPath = req.files?.businessPhoto ? req.files.businessPhoto[0].path : null;

    // Check if user already exists
    const normalizedEmail = email ? email.toLowerCase() : undefined;
    const existingUser = await User.findOne({
      $or: [
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        ...(phoneNumber ? [{ phoneNumber }] : [])
      ]
    });

    if (existingUser) {
      // Clean up uploaded files
      await removeFileIfExists(idCardFrontPath);
      await removeFileIfExists(idCardBackPath);
      await removeFileIfExists(businessPhotoPath);

      return res.status(400).json({
        success: false,
        message: 'User with this email or phone number already exists'
      });
    }

    // Upload ID card images to Cloudinary
    let frontImageUrl = null;
    let backImageUrl = null;
    let businessPhotoUrl = null;
    let frontImagePublicId = null;
    let backImagePublicId = null;
    let businessPhotoPublicId = null;

    if (idCardFrontPath) {
      const frontUploadResult = await uploadToCloudinary(idCardFrontPath, 'id-cards');
      if (frontUploadResult.success) {
        frontImageUrl = frontUploadResult.url;
        frontImagePublicId = frontUploadResult.publicId;
      }
      // Delete local file after upload
      await removeFileIfExists(idCardFrontPath);
    }

    if (idCardBackPath) {
      const backUploadResult = await uploadToCloudinary(idCardBackPath, 'id-cards');
      if (backUploadResult.success) {
        backImageUrl = backUploadResult.url;
        backImagePublicId = backUploadResult.publicId;
      }
      // Delete local file after upload
      await removeFileIfExists(idCardBackPath);
    }

    if (businessPhotoPath) {
      const businessUploadResult = await uploadToCloudinary(businessPhotoPath, 'business-photos');
      if (businessUploadResult.success) {
        businessPhotoUrl = businessUploadResult.url;
        businessPhotoPublicId = businessUploadResult.publicId;
      }
      await removeFileIfExists(businessPhotoPath);
    }

    try {
      const identifiers = [];
      if (normalizedEmail) identifiers.push({ email: normalizedEmail });
      if (phoneNumber) identifiers.push({ phoneNumber });

      const pendingQuery = identifiers.length > 1 ? { $or: identifiers } : identifiers[0];
      const existingPending = await BusinessOwnerRegistrationOTP.findOne(pendingQuery);

      if (existingPending) {
        if (normalizedEmail && existingPending.email && normalizedEmail !== existingPending.email) {
          return res.status(400).json({
            success: false,
            message: 'Email does not match existing pending registration'
          });
        }
        if (phoneNumber && existingPending.phoneNumber && phoneNumber !== existingPending.phoneNumber) {
          return res.status(400).json({
            success: false,
            message: 'Phone number does not match existing pending registration'
          });
        }
      }

      if (existingPending && businessPhotoPublicId && existingPending.businessPhotoPublicId) {
        await removeCloudinaryIfExists(existingPending.businessPhotoPublicId);
      }
      if (existingPending && frontImagePublicId && existingPending.idCardFrontPublicId) {
        await removeCloudinaryIfExists(existingPending.idCardFrontPublicId);
      }
      if (existingPending && backImagePublicId && existingPending.idCardBackPublicId) {
        await removeCloudinaryIfExists(existingPending.idCardBackPublicId);
      }

      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);
      const otp = generateOTP();
      const otpHash = hashValue(otp);
      const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

      const update = {
        email: normalizedEmail || existingPending?.email || undefined,
        phoneNumber: phoneNumber || existingPending?.phoneNumber || undefined,
        fullName: fullName || existingPending?.fullName,
        passwordHash,
        dateOfBirth: dateOfBirth || existingPending?.dateOfBirth,
        businessName: businessName || existingPending?.businessName,
        businessCategory: businessCategory || existingPending?.businessCategory,
        businessAddress: businessAddress || existingPending?.businessAddress,
        businessPhotoUrl: businessPhotoUrl || existingPending?.businessPhotoUrl || null,
        businessPhotoPublicId: businessPhotoPublicId || existingPending?.businessPhotoPublicId || null,
        idCardFrontUrl: frontImageUrl || existingPending?.idCardFrontUrl || null,
        idCardFrontPublicId: frontImagePublicId || existingPending?.idCardFrontPublicId || null,
        idCardBackUrl: backImageUrl || existingPending?.idCardBackUrl || null,
        idCardBackPublicId: backImagePublicId || existingPending?.idCardBackPublicId || null,
        occupation: occupation || existingPending?.occupation || null,
        referenceId: referenceId || existingPending?.referenceId || null,
        otpHash,
        otpExpiresAt,
        isVerified: false,
        verificationTokenHash: undefined,
        verificationTokenExpiresAt: undefined
      };

      const pending = await BusinessOwnerRegistrationOTP.findOneAndUpdate(
        pendingQuery,
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      try {
        const displayName = fullName || existingPending?.fullName || 'there';
        if (normalizedEmail) {
          await sendRegistrationOTPEmail(normalizedEmail, otp, displayName);
        } else {
          await sendRegistrationOTPSMS(phoneNumber, otp, displayName);
        }
      } catch (sendError) {
        await BusinessOwnerRegistrationOTP.deleteOne({ _id: pending._id });
        await removeCloudinaryIfExists(businessPhotoPublicId);
        await removeCloudinaryIfExists(frontImagePublicId);
        await removeCloudinaryIfExists(backImagePublicId);
        console.error('Error sending business owner registration OTP:', sendError);
        return res.status(500).json({
          success: false,
          message: 'Failed to send OTP. Please try again later.',
          error: process.env.NODE_ENV === 'development' ? sendError.message : undefined
        });
      }

      return res.status(200).json({
        success: true,
        message: `OTP has been sent to your ${normalizedEmail ? 'email' : 'phone number'}.`,
        data: {
          sentTo: normalizedEmail ? 'email' : 'phone',
          expiresIn: '10 minutes'
        }
      });
    } catch (transactionError) {
      throw transactionError;
    }

  } catch (error) {
    console.error('Business owner registration error:', error);

    // Clean up uploaded files on error
    if (req.files) {
      if (req.files.idCardFront) {
        await removeFileIfExists(req.files.idCardFront[0].path);
      }
      if (req.files.idCardBack) {
        await removeFileIfExists(req.files.idCardBack[0].path);
      }
      if (req.files.businessPhoto) {
        await removeFileIfExists(req.files.businessPhoto[0].path);
      }
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred during registration',
      error: error.message
    });
  }
};

/**
 * Verify business owner registration OTP and create business owner
 * POST /api/business-owners/register/verify-otp
 */
exports.verifyBusinessOwnerRegistrationOTP = async (req, res) => {
  try {
    const { email, phoneNumber, otp } = req.body;

    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone number is required'
      });
    }

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: 'OTP is required'
      });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'OTP must be a 6-digit number'
      });
    }

    const normalizedEmail = email ? email.toLowerCase() : undefined;
    const pending = await BusinessOwnerRegistrationOTP.findOne(
      normalizedEmail ? { email: normalizedEmail } : { phoneNumber }
    ).select('+otpHash +otpExpiresAt +passwordHash');

    if (!pending) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    if (pending.otpExpiresAt && Date.now() > pending.otpExpiresAt.getTime()) {
      await BusinessOwnerRegistrationOTP.deleteOne({ _id: pending._id });
      await removePendingBusinessOwnerAssets(pending);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    const isValid = hashValue(otp) === pending.otpHash;
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please try again.'
      });
    }

    if (
      !pending.fullName ||
      !pending.passwordHash ||
      !pending.businessName ||
      !pending.businessCategory ||
      !pending.businessAddress ||
      !pending.dateOfBirth
    ) {
      return res.status(400).json({
        success: false,
        message: 'Registration data is incomplete. Please register again.'
      });
    }

    const identifiers = [];
    if (pending.email) identifiers.push({ email: pending.email });
    if (pending.phoneNumber) identifiers.push({ phoneNumber: pending.phoneNumber });

    const existingUser = await User.findOne({ $or: identifiers });
    if (existingUser) {
      await BusinessOwnerRegistrationOTP.deleteOne({ _id: pending._id });
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone number already exists'
      });
    }

    const authData = await createBusinessOwnerAndTokens(req, {
      fullName: pending.fullName,
      email: pending.email,
      phoneNumber: pending.phoneNumber,
      passwordHash: pending.passwordHash,
      dateOfBirth: pending.dateOfBirth,
      businessName: pending.businessName,
      businessCategory: pending.businessCategory,
      businessAddress: pending.businessAddress,
      businessPhotoUrl: pending.businessPhotoUrl,
      idCardFrontUrl: pending.idCardFrontUrl,
      idCardBackUrl: pending.idCardBackUrl,
      occupation: pending.occupation,
      referenceId: pending.referenceId
    });

    await BusinessOwnerRegistrationOTP.deleteOne({ _id: pending._id });

    return res.status(201).json({
      success: true,
      message: 'Business owner registration successful.',
      data: {
        user: {
          id: authData.user._id,
          fullName: authData.user.fullName,
          email: authData.user.email,
          phoneNumber: authData.user.phoneNumber,
          userType: authData.user.userType,
          authProvider: authData.user.authProvider
        },
        businessOwner: {
          id: authData.businessOwner._id,
          dateOfBirth: authData.businessOwner.dateOfBirth,
          businessName: authData.businessOwner.businessName,
          businessCategory: authData.businessOwner.businessCategory,
          businessAddress: authData.businessOwner.businessAddress,
          businessPhoto: authData.businessOwner.businessPhoto,
          occupation: authData.businessOwner.occupation,
          referenceId: authData.businessOwner.referenceId,
          idCardUploaded: {
            front: !!authData.businessOwner.idCard?.frontImage,
            back: !!authData.businessOwner.idCard?.backImage
          }
        },
        accessToken: authData.accessToken,
        refreshToken: authData.refreshToken,
        expiresIn: authData.accessExpiresIn,
        tokenType: 'Bearer'
      }
    });
  } catch (error) {
    console.error('Verify business owner OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Login business owner
 * POST /api/business-owners/login
 */
exports.loginBusinessOwner = async (req, res) => {
  try {
    const { email, phoneNumber, password, fcmToken, platform } = req.body;

    // Validate input
    if ((!email && !phoneNumber) || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone number and password are required'
      });
    }

    // Find user by email or phone
    const user = await User.findOne({
      $or: [
        ...(email ? [{ email: email.toLowerCase() }] : []),
        ...(phoneNumber ? [{ phoneNumber }] : [])
      ],
      userType: 'businessOwner' // Only allow business owners to login through this endpoint
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Get business owner profile
    const businessOwner = await BusinessOwner.findOne({ userId: user._id });

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    // Generate access token and refresh token
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // Calculate refresh token expiration
    const refreshExpiresIn = getTokenExpiresIn('refresh');
    const expiresAt = new Date(Date.now() + refreshExpiresIn * 1000);

    // Store refresh token in database
    const refreshTokenDoc = new RefreshToken({
      userId: user._id,
      token: crypto.createHash('sha256').update(refreshToken).digest('hex'),
      expiresAt,
      deviceInfo: {
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress
      }
    });

    await refreshTokenDoc.save();

    // Get access token expiration time
    const accessExpiresIn = getTokenExpiresIn('access');

    if (fcmToken) {
      try {
        await upsertDeviceToken({
          userId: user._id,
          token: fcmToken,
          platform: platform || 'unknown'
        });
      } catch (tokenError) {
        console.error('Register device token on business owner login error:', tokenError);
      }
    }

    // Return success response
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          userType: user.userType,
          profilePicture: user.profilePicture
        },
        businessOwner: {
          id: businessOwner._id,
          occupation: businessOwner.occupation,
          referenceId: businessOwner.referenceId
        },
        accessToken,
        refreshToken,
        expiresIn: accessExpiresIn,
        tokenType: 'Bearer'
      }
    });

  } catch (error) {
    console.error('Business owner login error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during login',
      error: error.message
    });
  }
};

/**
 * Logout business owner
 * POST /api/business-owners/logout
 */
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const storedToken = await RefreshToken.findOne({ token: hashedToken });

    if (storedToken) {
      storedToken.isRevoked = true;
      await storedToken.save();
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Business owner logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout',
      error: error.message
    });
  }
};

/**
 * Logout business owner from all devices
 * POST /api/business-owners/logout-all
 */
exports.logoutAll = async (req, res) => {
  try {
    const userId = req.user._id;
    await RefreshToken.revokeAllForUser(userId);

    res.json({
      success: true,
      message: 'Logged out from all devices successfully'
    });
  } catch (error) {
    console.error('Business owner logout all error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout',
      error: error.message
    });
  }
};

/**
 * Get business owner profile
 * GET /api/business-owners/me
 */
exports.getBusinessOwnerProfile = async (req, res) => {
  try {
    // User is already attached to req by auth middleware
    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id })
      .populate('userId', '-password -resetPasswordOTP -resetPasswordOTPExpires');

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        businessOwner
      }
    });

  } catch (error) {
    console.error('Get business owner profile error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching business owner profile',
      error: error.message
    });
  }
};

/**
 * Update business owner profile
 * PUT /api/business-owners/me
 */
exports.updateBusinessOwnerProfile = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phoneNumber,
      dateOfBirth,
      occupation,
      currentPassword,
      newPassword,
      confirmPassword
    } = req.body;

    const userId = req.user._id;

    // Find user and business owner
    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const businessOwner = await BusinessOwner.findOne({ userId: userId });
    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    // Handle password change if provided (all three password fields must be present)
    if (currentPassword || newPassword || confirmPassword) {
      // Validate all password fields are provided
      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'To change password, current password, new password, and confirm password are all required'
        });
      }

      // Validate new password and confirm password match
      if (newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'New password and confirm password do not match'
        });
      }

      // Validate new password strength
      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters long'
        });
      }

      // Check if user has a password (OAuth users might not)
      if (!user.password) {
        return res.status(400).json({
          success: false,
          message: 'Cannot change password for OAuth-authenticated accounts'
        });
      }

      // Verify current password
      const isPasswordValid = await user.comparePassword(currentPassword);
      if (!isPasswordValid) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Check if new password is same as current
      const isSamePassword = await user.comparePassword(newPassword);
      if (isSamePassword) {
        return res.status(400).json({
          success: false,
          message: 'New password must be different from current password'
        });
      }

      // Update password
      user.password = newPassword;
    }

    // Check if email is being changed and already exists
    if (email && email !== user.email) {
      const emailExists = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: userId }
      });

      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use by another account'
        });
      }
    }

    // Check if phone number is being changed and already exists
    if (phoneNumber && phoneNumber !== user.phoneNumber) {
      const phoneExists = await User.findOne({
        phoneNumber,
        _id: { $ne: userId }
      });

      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already in use by another account'
        });
      }
    }

    // Update user fields
    if (fullName) user.fullName = fullName;
    if (email) user.email = email.toLowerCase();
    if (phoneNumber) user.phoneNumber = phoneNumber;

    // Handle profile picture upload
    if (req.file) {
      try {
        // Upload new profile picture to Cloudinary
        const uploadResult = await uploadToCloudinary(req.file.path, 'profiles');

        if (uploadResult.success) {
          // Delete old profile picture from Cloudinary if exists
          if (user.profilePicture) {
            // Extract public ID from URL
            const urlParts = user.profilePicture.split('/');
            const publicIdWithExtension = urlParts.slice(-2).join('/');
            const publicId = publicIdWithExtension.split('.')[0];
            await deleteFromCloudinary(publicId);
          }

          user.profilePicture = uploadResult.url;
        }

        // Delete local file after upload
        await fs.unlink(req.file.path);
      } catch (uploadError) {
        console.error('Profile picture upload error:', uploadError);
        // Continue even if upload fails - don't block profile update
      }
    }

    await user.save();

    // Update business owner specific fields
    if (occupation !== undefined) businessOwner.occupation = occupation;
    if (dateOfBirth) {
      const dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date of birth format'
        });
      }
      if (dob >= new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Date of birth must be in the past'
        });
      }
      businessOwner.dateOfBirth = dob;
    }

    await businessOwner.save();

    res.status(200).json({
      success: true,
      message: 'Business owner profile updated successfully',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          profilePicture: user.profilePicture,
          userType: user.userType
        },
        businessOwner: {
          id: businessOwner._id,
          dateOfBirth: businessOwner.dateOfBirth,
          occupation: businessOwner.occupation,
          referenceId: businessOwner.referenceId,
          businessName: businessOwner.businessName,
          businessCategory: businessOwner.businessCategory,
          businessAddress: businessOwner.businessAddress
        }
      }
    });

  } catch (error) {
    console.error('Update business owner profile error:', error);

    // Clean up uploaded file if exists
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting uploaded file:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred while updating business owner profile',
      error: error.message
    });
  }
};

/**
 * Get business owner stats
 * GET /api/business-owners/stats
 */
exports.getBusinessOwnerStats = async (req, res) => {
  try {
    const BusinessOwnerBooking = require('../models/BusinessOwnerBooking');
    const BusinessOwnerAppointment = require('../models/BusinessOwnerAppointment');
    const Employee = require('../models/Employee');

    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });
    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    const businessOwnerId = businessOwner._id;
    const activeBookingStatuses = ['pending', 'confirmed', 'in_progress'];
    const activeAppointmentStatuses = ['pending', 'confirmed', 'in_progress'];

    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPrevMonth = new Date(startOfThisMonth.getTime() - 1);

    const [
      bookingCount,
      appointmentCount,
      employeeCount,
      activeBookingCount,
      activeAppointmentCount,
      bookingIncomeAgg,
      appointmentIncomeAgg,
      thisMonthBookingCount,
      thisMonthAppointmentCount,
      prevMonthBookingCount,
      prevMonthAppointmentCount,
      thisMonthBookingIncomeAgg,
      thisMonthAppointmentIncomeAgg,
      prevMonthBookingIncomeAgg,
      prevMonthAppointmentIncomeAgg,
      thisMonthActiveBookingCount,
      thisMonthActiveAppointmentCount,
      prevMonthActiveBookingCount,
      prevMonthActiveAppointmentCount,
      thisMonthEmployeeCount,
      prevMonthEmployeeCount
    ] = await Promise.all([
      BusinessOwnerBooking.countDocuments({ businessOwnerId }),
      BusinessOwnerAppointment.countDocuments({ businessOwnerId }),
      Employee.countDocuments({ businessOwnerId, isActive: true }),
      BusinessOwnerBooking.countDocuments({
        businessOwnerId,
        bookingStatus: { $in: activeBookingStatuses }
      }),
      BusinessOwnerAppointment.countDocuments({
        businessOwnerId,
        appointmentStatus: { $in: activeAppointmentStatuses }
      }),
      BusinessOwnerBooking.aggregate([
        { $match: { businessOwnerId, paymentStatus: 'completed' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      BusinessOwnerAppointment.aggregate([
        { $match: { businessOwnerId, paymentStatus: 'completed' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      BusinessOwnerBooking.countDocuments({
        businessOwnerId,
        createdAt: { $gte: startOfThisMonth }
      }),
      BusinessOwnerAppointment.countDocuments({
        businessOwnerId,
        createdAt: { $gte: startOfThisMonth }
      }),
      BusinessOwnerBooking.countDocuments({
        businessOwnerId,
        createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
      }),
      BusinessOwnerAppointment.countDocuments({
        businessOwnerId,
        createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
      }),
      BusinessOwnerBooking.aggregate([
        { $match: { businessOwnerId, paymentStatus: 'completed', createdAt: { $gte: startOfThisMonth } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      BusinessOwnerAppointment.aggregate([
        { $match: { businessOwnerId, paymentStatus: 'completed', createdAt: { $gte: startOfThisMonth } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      BusinessOwnerBooking.aggregate([
        { $match: { businessOwnerId, paymentStatus: 'completed', createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      BusinessOwnerAppointment.aggregate([
        { $match: { businessOwnerId, paymentStatus: 'completed', createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      BusinessOwnerBooking.countDocuments({
        businessOwnerId,
        bookingStatus: { $in: activeBookingStatuses },
        createdAt: { $gte: startOfThisMonth }
      }),
      BusinessOwnerAppointment.countDocuments({
        businessOwnerId,
        appointmentStatus: { $in: activeAppointmentStatuses },
        createdAt: { $gte: startOfThisMonth }
      }),
      BusinessOwnerBooking.countDocuments({
        businessOwnerId,
        bookingStatus: { $in: activeBookingStatuses },
        createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
      }),
      BusinessOwnerAppointment.countDocuments({
        businessOwnerId,
        appointmentStatus: { $in: activeAppointmentStatuses },
        createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
      }),
      Employee.countDocuments({
        businessOwnerId,
        isActive: true,
        createdAt: { $gte: startOfThisMonth }
      }),
      Employee.countDocuments({
        businessOwnerId,
        isActive: true,
        createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
      })
    ]);

    const bookingIncome = bookingIncomeAgg[0]?.total || 0;
    const appointmentIncome = appointmentIncomeAgg[0]?.total || 0;
    const thisMonthBookingIncome = thisMonthBookingIncomeAgg[0]?.total || 0;
    const thisMonthAppointmentIncome = thisMonthAppointmentIncomeAgg[0]?.total || 0;
    const prevMonthBookingIncome = prevMonthBookingIncomeAgg[0]?.total || 0;
    const prevMonthAppointmentIncome = prevMonthAppointmentIncomeAgg[0]?.total || 0;

    const totalBookings = bookingCount + appointmentCount;
    const totalIncome = bookingIncome + appointmentIncome;
    const totalEmployeesActive = employeeCount;
    const totalActiveOrders = activeBookingCount + activeAppointmentCount;

    const thisMonthBookings = thisMonthBookingCount + thisMonthAppointmentCount;
    const prevMonthBookings = prevMonthBookingCount + prevMonthAppointmentCount;
    const thisMonthIncome = thisMonthBookingIncome + thisMonthAppointmentIncome;
    const prevMonthIncome = prevMonthBookingIncome + prevMonthAppointmentIncome;
    const thisMonthActiveOrders = thisMonthActiveBookingCount + thisMonthActiveAppointmentCount;
    const prevMonthActiveOrders = prevMonthActiveBookingCount + prevMonthActiveAppointmentCount;

    const calcPercentChange = (current, previous) => {
      if (previous === 0) {
        return current === 0 ? 0 : 100;
      }
      return Math.round(((current - previous) / previous) * 100);
    };

    res.status(200).json({
      success: true,
      data: {
        totalBookings,
        totalIncome,
        totalEmployeesActive,
        totalActiveOrders,
        growth: {
          totalBookings: calcPercentChange(thisMonthBookings, prevMonthBookings),
          totalIncome: calcPercentChange(thisMonthIncome, prevMonthIncome),
          totalEmployeesActive: calcPercentChange(thisMonthEmployeeCount, prevMonthEmployeeCount),
          totalActiveOrders: calcPercentChange(thisMonthActiveOrders, prevMonthActiveOrders)
        }
      }
    });
  } catch (error) {
    console.error('Get business owner stats error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching business owner stats',
      error: error.message
    });
  }
};

/**
 * Get business owner activities
 * GET /api/business-owners/activities
 * Query params:
 *  - range: today | week | month | all (default: all)
 *  - status: all | completed | cancelled (default: all)
 *  - limit: max items to return (default: 50, max: 200)
 */
exports.getBusinessOwnerActivities = async (req, res) => {
  try {
    const BusinessOwnerBooking = require('../models/BusinessOwnerBooking');
    const BusinessOwnerAppointment = require('../models/BusinessOwnerAppointment');

    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });
    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    const range = (req.query.range || 'all').toLowerCase();
    const statusFilter = (req.query.status || 'all').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

    const now = new Date();
    let startDate = null;
    if (range === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (range !== 'all') {
      return res.status(400).json({
        success: false,
        message: 'Invalid range filter. Use today, week, month, or all.'
      });
    }

    const bookingQuery = { businessOwnerId: businessOwner._id };
    const appointmentQuery = { businessOwnerId: businessOwner._id };

    if (startDate) {
      bookingQuery.updatedAt = { $gte: startDate };
      appointmentQuery.updatedAt = { $gte: startDate };
    }

    if (statusFilter === 'completed') {
      bookingQuery.bookingStatus = 'completed';
      appointmentQuery.appointmentStatus = 'completed';
    } else if (statusFilter === 'cancelled') {
      bookingQuery.bookingStatus = { $in: ['cancelled', 'rejected'] };
      appointmentQuery.appointmentStatus = { $in: ['cancelled', 'rejected', 'no_show'] };
    } else if (statusFilter !== 'all') {
      return res.status(400).json({
        success: false,
        message: 'Invalid status filter. Use all, completed, or cancelled.'
      });
    }

    const [bookings, appointments] = await Promise.all([
      BusinessOwnerBooking.find(bookingQuery)
        .populate('userId', 'fullName profilePicture')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select('userId bookingStatus paymentStatus totalAmount serviceSnapshot updatedAt createdAt'),
      BusinessOwnerAppointment.find(appointmentQuery)
        .populate('userId', 'fullName profilePicture')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select('userId appointmentStatus paymentStatus totalAmount serviceSnapshot updatedAt createdAt')
    ]);

    const resolveActivity = (status, paymentStatus) => {
      if (paymentStatus === 'completed') return 'payment_received';
      if (status === 'completed') return 'order_completed';
      if (['cancelled', 'rejected', 'no_show'].includes(status)) return 'order_canceled';
      return 'new_booking_received';
    };

    const activities = [
      ...bookings.map((booking) => ({
        orderId: booking._id,
        type: 'booking',
        userName: booking.userId?.fullName || 'Unknown',
        userProfilePicture: booking.userId?.profilePicture || null,
        status: booking.bookingStatus,
        activity: resolveActivity(booking.bookingStatus, booking.paymentStatus),
        price: booking.totalAmount,
        hoursAgo: Math.floor((now - booking.updatedAt) / (60 * 60 * 1000)),
        updatedAt: booking.updatedAt,
        title: booking.serviceSnapshot?.serviceName || 'Service'
      })),
      ...appointments.map((appointment) => ({
        orderId: appointment._id,
        type: 'appointment',
        userName: appointment.userId?.fullName || 'Unknown',
        userProfilePicture: appointment.userId?.profilePicture || null,
        status: appointment.appointmentStatus,
        activity: resolveActivity(appointment.appointmentStatus, appointment.paymentStatus),
        price: appointment.totalAmount,
        hoursAgo: Math.floor((now - appointment.updatedAt) / (60 * 60 * 1000)),
        updatedAt: appointment.updatedAt,
        title: appointment.serviceSnapshot?.serviceName || appointment.serviceSnapshot?.headline || 'Service'
      }))
    ]
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, limit);

    res.status(200).json({
      success: true,
      data: {
        activities,
        count: activities.length
      }
    });
  } catch (error) {
    console.error('Get business owner activities error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while fetching activities'
    });
  }
};

/**
 * @desc    Get business owner notifications
 * @route   GET /api/business-owners/notifications
 * @access  Private (Business Owner only)
 */
exports.getBusinessOwnerNotifications = async (req, res) => {
  try {
    const { isRead, page = 1, limit = 20 } = req.query;
    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    const query = { userId: businessOwner.userId, userType: 'businessOwner' };
    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    const skip = (page - 1) * limit;

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await Notification.countDocuments(query);

    res.status(200).json({
      success: true,
      count: notifications.length,
      total,
      currentPage: parseInt(page, 10),
      totalPages: Math.ceil(total / limit),
      data: notifications
    });
  } catch (error) {
    console.error('Get business owner notifications error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching notifications'
    });
  }
};

/**
 * Get business details for users
 * GET /api/user/businesses/:businessOwnerId/details
 */
exports.getBusinessDetailsForUser = async (req, res) => {
  try {
    const { businessOwnerId } = req.params;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(businessOwnerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid business owner id'
      });
    }

    const businessOwner = await BusinessOwner.findById(businessOwnerId)
      .populate('userId', 'isActive');

    if (!businessOwner || businessOwner.userId?.isActive === false) {
      return res.status(404).json({
        success: false,
        message: 'Business owner not found'
      });
    }

    const businessName = businessOwner.businessProfile?.name || businessOwner.businessName;
    const businessCoverPhoto = buildImageUrl(req, businessOwner.businessProfile?.coverPhoto);
    const businessPhoto = buildImageUrl(req, businessOwner.businessPhoto);
    const businessLocation =
      businessOwner.businessProfile?.location || businessOwner.businessAddress?.fullAddress || null;
    const about = businessOwner.businessProfile?.about || null;

    const [employeeCount, serviceStats, employeeServices] = await Promise.all([
      Employee.countDocuments({ businessOwnerId, isActive: true }),
      EmployeeService.aggregate([
        { $match: { businessOwnerId: businessOwner._id, isActive: true } },
        {
          $group: {
            _id: '$businessOwnerId',
            totalServices: { $sum: 1 },
            appointmentServices: { $sum: { $cond: ['$appointmentEnabled', 1, 0] } }
          }
        }
      ]),
      EmployeeService.find({ businessOwnerId, isActive: true })
        .populate('employeeId', 'fullName profilePhoto')
        .sort({ createdAt: -1 })
    ]);

    const serviceCounts = serviceStats[0] || { totalServices: 0, appointmentServices: 0 };

    const now = Date.now();
    const team = employeeServices.map((service) => {
      const createdAt = service.createdAt ? new Date(service.createdAt) : null;
      const daysAgo = createdAt
        ? Math.floor((now - createdAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const slotPrices = (service.appointmentSlots || []).map(slot => slot.price);
      const minAppointmentPrice = slotPrices.length > 0 ? Math.min(...slotPrices) : null;

      return {
        employeeId: service.employeeId?._id,
        employeeServicePhoto: buildImageUrl(req, service.servicePhoto),
        employeeImage: buildImageUrl(req, service.employeeId?.profilePhoto),
        employeeName: service.employeeId?.fullName || null,
        employeeAddress: businessLocation,
        serviceHeadline: service.headline,
        serviceDescription: service.description,
        rating: service.rating,
        totalReviews: service.totalReviews,
        basePrice: service.basePrice,
        appointmentEnabled: service.appointmentEnabled,
        appointmentSlots: service.appointmentSlots,
        minAppointmentPrice,
        daysAgo
      };
    });

    const serviceHeadlines = employeeServices.map(service => ({
      serviceId: service._id,
      headline: service.headline
    }));

    const [bookingReviews, appointmentReviews] = await Promise.all([
      BusinessOwnerBooking.find({
        businessOwnerId,
        rating: { $ne: null },
        $or: [
          { moderationStatus: { $exists: false } },
          { moderationStatus: 'active' }
        ]
      })
        .populate('userId', 'fullName profilePicture')
        .select('rating review reviewedAt createdAt userId')
        .sort({ reviewedAt: -1, createdAt: -1 })
        .limit(20),
      BusinessOwnerAppointment.find({
        businessOwnerId,
        rating: { $ne: null },
        $or: [
          { moderationStatus: { $exists: false } },
          { moderationStatus: 'active' }
        ]
      })
        .populate('userId', 'fullName profilePicture')
        .select('rating review reviewedAt createdAt userId')
        .sort({ reviewedAt: -1, createdAt: -1 })
        .limit(20)
    ]);

    const reviews = [...bookingReviews, ...appointmentReviews]
      .map(review => ({
        reviewId: review._id,
        rating: review.rating,
        comment: review.review,
        createdAt: review.reviewedAt || review.createdAt,
        user: {
          name: review.userId?.fullName || 'Anonymous',
          image: buildImageUrl(req, review.userId?.profilePicture)
        }
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20);

    res.status(200).json({
      success: true,
      data: {
        businessDetails: {
          businessOwnerId: businessOwner._id,
          businessCoverPhoto,
          businessPhoto,
          businessName,
          employeeCount,
          serviceCount: serviceCounts.totalServices || 0,
          appointmentServiceCount: serviceCounts.appointmentServices || 0,
          businessLocation,
          about
        },
        team,
        services: serviceHeadlines,
        reviews
      }
    });
  } catch (error) {
    console.error('Get business details for user error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching business details',
      error: error.message
    });
  }
};

/**
 * Get employee profile for users
 * GET /api/user/employees/:employeeId/profile
 */
exports.getEmployeeProfileForUser = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid employee id'
      });
    }

    const employee = await Employee.findOne({
      _id: employeeId,
      isActive: true
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const businessOwner = await BusinessOwner.findById(employee.businessOwnerId);
    const address =
      businessOwner?.businessProfile?.location ||
      businessOwner?.businessAddress?.fullAddress ||
      'Address not available';

    const services = await EmployeeService.find({
      employeeId: employee._id,
      isActive: true
    }).sort({ createdAt: -1 });

    const totalReviews = services.reduce((sum, service) => sum + (service.totalReviews || 0), 0);
    const weightedRating = totalReviews > 0
      ? services.reduce((sum, service) =>
        sum + ((service.rating || 0) * (service.totalReviews || 0)), 0) / totalReviews
      : (services.length > 0
        ? services.reduce((sum, service) => sum + (service.rating || 0), 0) / services.length
        : 0);

    const now = Date.now();
    const serviceItems = services.map((service) => {
      const createdAt = service.createdAt ? new Date(service.createdAt) : null;
      const daysAgo = createdAt
        ? Math.floor((now - createdAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const slotPrices = (service.appointmentSlots || []).map(slot => slot.price);
      const minAppointmentPrice = slotPrices.length > 0 ? Math.min(...slotPrices) : null;

      return {
        serviceId: service._id,
        image: buildImageUrl(req, service.servicePhoto),
        title: service.headline,
        about: service.description,
        rating: service.rating,
        basePrice: service.basePrice,
        appointmentEnabled: service.appointmentEnabled,
        appointmentSlots: service.appointmentSlots,
        minAppointmentPrice,
        daysAgo
      };
    });

    const serviceIds = services.map(service => service._id);
    const [bookingReviews, appointmentReviews] = await Promise.all([
      BusinessOwnerBooking.find({
        employeeServiceId: { $in: serviceIds },
        rating: { $ne: null },
        $or: [
          { moderationStatus: { $exists: false } },
          { moderationStatus: 'active' }
        ]
      })
        .populate('userId', 'fullName profilePicture')
        .select('rating review reviewedAt createdAt userId')
        .sort({ reviewedAt: -1, createdAt: -1 })
        .limit(20),
      BusinessOwnerAppointment.find({
        employeeServiceId: { $in: serviceIds },
        rating: { $ne: null },
        $or: [
          { moderationStatus: { $exists: false } },
          { moderationStatus: 'active' }
        ]
      })
        .populate('userId', 'fullName profilePicture')
        .select('rating review reviewedAt createdAt userId')
        .sort({ reviewedAt: -1, createdAt: -1 })
        .limit(20)
    ]);

    const reviews = [...bookingReviews, ...appointmentReviews]
      .map(review => ({
        reviewId: review._id,
        rating: review.rating,
        comment: review.review,
        createdAt: review.reviewedAt || review.createdAt,
        user: {
          name: review.userId?.fullName || 'Anonymous',
          image: buildImageUrl(req, review.userId?.profilePicture)
        }
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20);

    res.status(200).json({
      success: true,
      data: {
        provider: {
          name: employee.fullName,
          image: buildImageUrl(req, employee.profilePhoto),
          address,
          rating: Math.round(weightedRating * 10) / 10,
          totalReviews
        },
        allServices: {
          totalServices: services.length,
          services: serviceItems
        },
        reviews,
        portfolio: []
      }
    });
  } catch (error) {
    console.error('Get employee profile for user error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching employee profile',
      error: error.message
    });
  }
};

/**
 * Get top businesses for users (by business owner rating)
 * GET /api/user/top-businesses
 */
exports.getTopBusinesses = async (req, res) => {
  try {
    const includeAll = req.query.all === 'true' || req.query.all === '1';
    const parsedLimit = parseInt(req.query.limit || '10', 10);
    const limit = Number.isNaN(parsedLimit)
      ? 10
      : Math.min(Math.max(parsedLimit, 1), 200);

    const businessOwners = await BusinessOwner.find()
      .populate('userId', 'isActive fullName profilePicture')
      .select('businessName businessPhoto businessAddress businessProfile discoveryPin')
      .lean();

    const activeOwners = businessOwners.filter(owner => owner.userId?.isActive !== false);
    const ownerIds = activeOwners.map(owner => owner._id);

    const [serviceStats, employeeCounts] = await Promise.all([
      EmployeeService.aggregate([
        { $match: { businessOwnerId: { $in: ownerIds }, isActive: true } },
        {
          $group: {
            _id: '$businessOwnerId',
            totalServices: { $sum: 1 },
            appointmentServices: {
              $sum: { $cond: ['$appointmentEnabled', 1, 0] }
            },
            ratingSum: { $sum: { $multiply: ['$rating', '$totalReviews'] } },
            reviewCount: { $sum: '$totalReviews' }
          }
        },
        {
          $addFields: {
            rating: {
              $cond: [
                { $gt: ['$reviewCount', 0] },
                { $divide: ['$ratingSum', '$reviewCount'] },
                0
              ]
            }
          }
        }
      ]),
      Employee.aggregate([
        { $match: { businessOwnerId: { $in: ownerIds }, isActive: true } },
        { $group: { _id: '$businessOwnerId', count: { $sum: 1 } } }
      ])
    ]);

    const serviceMap = new Map(serviceStats.map(stat => [stat._id.toString(), stat]));
    const employeeMap = new Map(employeeCounts.map(stat => [stat._id.toString(), stat.count]));

    const topBusinesses = activeOwners.map(owner => {
      const stats = serviceMap.get(owner._id.toString());
      const businessName = owner.businessProfile?.name || owner.businessName;
      const businessPhoto = buildImageUrl(
        req,
        owner.businessProfile?.coverPhoto || owner.businessPhoto || null
      );
      const businessAddress = owner.businessProfile?.location || owner.businessAddress?.fullAddress || null;

      return {
        businessOwnerId: owner._id,
        businessOwnerName: owner.userId?.fullName || null,
        businessOwnerPhoto: buildImageUrl(req, owner.userId?.profilePicture),
        businessPhoto,
        businessName,
        businessRating: stats ? Math.round(stats.rating * 10) / 10 : 0,
        businessAddress,
        employeeCount: employeeMap.get(owner._id.toString()) || 0,
        serviceCount: stats?.totalServices || 0,
        appointmentServiceCount: stats?.appointmentServices || 0,
        discoveryPin: owner.discoveryPin || null,
        _id: owner._id
      };
    })
      .sort(compareBusinessesByPinThenRating)
      .map(({ discoveryPin, _id, ...business }) => business);

    const businesses = includeAll ? topBusinesses : topBusinesses.slice(0, limit);

    res.status(200).json({
      success: true,
      data: {
        businesses,
        count: businesses.length,
        total: topBusinesses.length
      }
    });
  } catch (error) {
    console.error('Get top businesses error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching top businesses',
      error: error.message
    });
  }
};

/**
 * Get all business owner profiles for authenticated users
 * GET /api/user/business-owner-profiles
 */
exports.getAllBusinessOwnerProfiles = async (req, res) => {
  try {
    const includeAll = req.query.all === 'true' || req.query.all === '1';
    const includeInactive = req.query.includeInactive === 'true' || req.query.includeInactive === '1';
    const search = (req.query.search || '').toString().trim().toLowerCase();

    const parsedPage = parseInt(req.query.page || '1', 10);
    const parsedLimit = parseInt(req.query.limit || '20', 10);
    const page = Number.isNaN(parsedPage) ? 1 : Math.max(parsedPage, 1);
    const limit = Number.isNaN(parsedLimit)
      ? 20
      : Math.min(Math.max(parsedLimit, 1), 200);

    const businessOwners = await BusinessOwner.find()
      .populate('userId', 'fullName email phoneNumber profilePicture location isActive createdAt')
      .populate('businessCategory', 'name slug icon')
      .populate('businessProfile.categories', 'name slug icon')
      .select(
        'userId businessName businessPhoto businessAddress businessCategory businessProfile occupation discoveryPin createdAt'
      )
      .lean();

    const scopedOwners = includeInactive
      ? businessOwners
      : businessOwners.filter((owner) => owner.userId?.isActive !== false);

    const filteredOwners = search
      ? scopedOwners.filter((owner) => {
          const businessName = owner.businessProfile?.name || owner.businessName || '';
          const businessAddress =
            owner.businessProfile?.location ||
            owner.businessAddress?.fullAddress ||
            owner.userId?.location?.address ||
            '';
          const ownerName = owner.userId?.fullName || '';
          const ownerEmail = owner.userId?.email || '';
          const ownerPhone = owner.userId?.phoneNumber || '';

          const haystack = `${businessName} ${businessAddress} ${ownerName} ${ownerEmail} ${ownerPhone}`.toLowerCase();
          return haystack.includes(search);
        })
      : scopedOwners;

    const ownerIds = filteredOwners.map((owner) => owner._id);

    const [serviceStats, employeeCounts] = await Promise.all([
      EmployeeService.aggregate([
        { $match: { businessOwnerId: { $in: ownerIds }, isActive: true } },
        {
          $group: {
            _id: '$businessOwnerId',
            totalServices: { $sum: 1 },
            appointmentServices: {
              $sum: { $cond: ['$appointmentEnabled', 1, 0] }
            },
            ratingSum: { $sum: { $multiply: ['$rating', '$totalReviews'] } },
            reviewCount: { $sum: '$totalReviews' }
          }
        },
        {
          $addFields: {
            rating: {
              $cond: [
                { $gt: ['$reviewCount', 0] },
                { $divide: ['$ratingSum', '$reviewCount'] },
                0
              ]
            }
          }
        }
      ]),
      Employee.aggregate([
        { $match: { businessOwnerId: { $in: ownerIds }, isActive: true } },
        { $group: { _id: '$businessOwnerId', count: { $sum: 1 } } }
      ])
    ]);

    const serviceMap = new Map(serviceStats.map((stat) => [stat._id.toString(), stat]));
    const employeeMap = new Map(employeeCounts.map((stat) => [stat._id.toString(), stat.count]));

    const profiles = filteredOwners
      .map((owner) => {
        const stats = serviceMap.get(owner._id.toString());
        const businessName = owner.businessProfile?.name || owner.businessName || null;
        const businessAddress =
          owner.businessProfile?.location ||
          owner.businessAddress?.fullAddress ||
          owner.userId?.location?.address ||
          null;
        const businessPhoto = buildImageUrl(
          req,
          owner.businessProfile?.coverPhoto || owner.businessPhoto || null
        );

        return {
          _id: owner._id,
          businessOwnerId: owner._id,
          userId: owner.userId?._id || null,
          businessOwnerName: owner.userId?.fullName || null,
          businessOwnerEmail: owner.userId?.email || null,
          businessOwnerPhoneNumber: owner.userId?.phoneNumber || null,
          businessOwnerPhoto: buildImageUrl(req, owner.userId?.profilePicture),
          occupation: owner.occupation || null,
          businessName,
          businessPhoto,
          businessAddress,
          businessCategory: owner.businessCategory
            ? {
                id: owner.businessCategory._id,
                name: owner.businessCategory.name || null,
                slug: owner.businessCategory.slug || null,
                icon: owner.businessCategory.icon || null
              }
            : null,
          businessProfile: {
            name: owner.businessProfile?.name || null,
            coverPhoto: buildImageUrl(req, owner.businessProfile?.coverPhoto),
            location: owner.businessProfile?.location || null,
            about: owner.businessProfile?.about || null,
            categories: owner.businessProfile?.categories || [],
            photos: buildImageUrls(req, owner.businessProfile?.photos || [])
          },
          businessRating: stats ? Math.round(stats.rating * 10) / 10 : 0,
          totalReviews: stats?.reviewCount || 0,
          employeeCount: employeeMap.get(owner._id.toString()) || 0,
          serviceCount: stats?.totalServices || 0,
          appointmentServiceCount: stats?.appointmentServices || 0,
          discoveryPin: owner.discoveryPin || null,
          createdAt: owner.createdAt || owner.userId?.createdAt || null
        };
      })
      .sort(compareBusinessesByPinThenRating);

    const total = profiles.length;
    const pagedProfiles = includeAll ? profiles : profiles.slice((page - 1) * limit, page * limit);
    const totalPages = includeAll ? 1 : Math.max(Math.ceil(total / limit), 1);

    res.status(200).json({
      success: true,
      message: 'Business owner profiles fetched successfully',
      data: {
        profiles: pagedProfiles,
        count: pagedProfiles.length,
        total,
        currentPage: includeAll ? 1 : page,
        totalPages
      }
    });
  } catch (error) {
    console.error('Get all business owner profiles error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching business owner profiles',
      error: error.message
    });
  }
};

/**
 * Forgot password - Send OTP to email
 * POST /api/business-owners/forgot-password
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find business owner user by email
    const user = await User.findOne({
      email: email.toLowerCase(),
      userType: 'businessOwner'
    });

    if (!user) {
      // For security, don't reveal if user exists or not
      return res.status(200).json({
        success: true,
        message: 'If a business owner account exists with this email, you will receive an OTP shortly.'
      });
    }

    // Check if business owner profile exists
    const businessOwner = await BusinessOwner.findOne({ userId: user._id });
    if (!businessOwner) {
      return res.status(200).json({
        success: true,
        message: 'If a business owner account exists with this email, you will receive an OTP shortly.'
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    // Generate OTP
    const otp = user.generatePasswordResetOTP();
    await user.save({ validateBeforeSave: false });

    // Send OTP via email
    try {
      await sendOTPEmail(user.email, otp, user.fullName);
      console.log(`Password reset OTP sent to business owner email: ${user.email}`);

      res.status(200).json({
        success: true,
        message: 'OTP has been sent to your email. Please check and enter the code.',
        data: {
          email: user.email,
          expiresIn: '10 minutes'
        }
      });
    } catch (sendError) {
      // Clear the OTP if sending failed
      user.resetPasswordOTP = undefined;
      user.resetPasswordOTPExpires = undefined;
      await user.save({ validateBeforeSave: false });

      console.error('Error sending OTP:', sendError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again later.',
        error: process.env.NODE_ENV === 'development' ? sendError.message : undefined
      });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while processing your request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Verify OTP
 * POST /api/business-owners/verify-otp
 */
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validate inputs
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: 'OTP is required'
      });
    }

    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'OTP must be a 6-digit number'
      });
    }

    // Find business owner user with OTP fields
    const user = await User.findOne({
      email: email.toLowerCase(),
      userType: 'businessOwner'
    }).select('+resetPasswordOTP +resetPasswordOTPExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    // Verify business owner profile exists
    const businessOwner = await BusinessOwner.findOne({ userId: user._id });
    if (!businessOwner) {
      return res.status(400).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    // Verify OTP
    const isValid = user.verifyPasswordResetOTP(otp);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please request a new one.'
      });
    }

    // OTP is valid
    res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You can now reset your password.',
      data: {
        email: user.email
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while verifying OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Reset password with OTP
 * POST /api/business-owners/reset-password
 */
exports.resetPasswordWithOTP = async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;

    // Validate inputs
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: 'OTP is required'
      });
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password are required'
      });
    }

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password do not match'
      });
    }

    // Validate password length
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Find business owner user with OTP fields and password
    const user = await User.findOne({
      email: email.toLowerCase(),
      userType: 'businessOwner'
    }).select('+resetPasswordOTP +resetPasswordOTPExpires +password');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    // Verify business owner profile exists
    const businessOwner = await BusinessOwner.findOne({ userId: user._id });
    if (!businessOwner) {
      return res.status(400).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    // Verify OTP
    const isValid = user.verifyPasswordResetOTP(otp);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please request a new one.'
      });
    }

    // Update password and clear OTP
    user.password = newPassword;
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpires = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while resetting password',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * Get business profile
 * GET /api/business-owners/business-profile
 */
exports.getBusinessProfile = async (req, res) => {
  try {
    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id })
      .populate('businessProfile.categories', 'name slug icon');

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    // Check if business profile has been created
    const hasProfile = businessOwner.businessProfile && 
                      (businessOwner.businessProfile.name || 
                       businessOwner.businessProfile.categories?.length > 0 ||
                       businessOwner.businessProfile.location ||
                       businessOwner.businessProfile.about);

    res.status(200).json({
      success: true,
      data: {
        businessProfile: businessOwner.businessProfile || null,
        hasProfile: hasProfile
      }
    });
  } catch (error) {
    console.error('Get business profile error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching business profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Create business profile (First time setup)
 * POST /api/business-owners/business-profile
 */
exports.createBusinessProfile = async (req, res) => {
  try {
    const { name, categories, location, about } = req.body;

    // Validate required fields
    if (!name || !categories || !location) {
      return res.status(400).json({
        success: false,
        message: 'Business name, categories, and location are required'
      });
    }

    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    // Check if business profile already exists
    if (businessOwner.businessProfile && 
        (businessOwner.businessProfile.name || 
         businessOwner.businessProfile.categories?.length > 0)) {
      return res.status(400).json({
        success: false,
        message: 'Business profile already exists. Use PUT method to update.'
      });
    }

    // Parse categories if it's a string (from form-data)
    const parsedCategories = typeof categories === 'string' 
      ? JSON.parse(categories) 
      : categories;

    // Validate categories array
    if (!Array.isArray(parsedCategories) || parsedCategories.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one category is required'
      });
    }

    // Initialize business profile
    businessOwner.businessProfile = {
      name: name,
      categories: parsedCategories,
      location: location,
      about: about || '',
      photos: []
    };

    // Handle cover photo upload
    if (req.files?.coverPhoto) {
      const coverPhotoPath = req.files.coverPhoto[0].path;
      
      try {
        const coverPhotoResult = await uploadToCloudinary(coverPhotoPath, 'business-profiles/covers');
        if (coverPhotoResult.success) {
          businessOwner.businessProfile.coverPhoto = coverPhotoResult.url;
        }
      } catch (uploadError) {
        console.error('Cover photo upload error:', uploadError);
      } finally {
        // Clean up local file
        await fs.unlink(coverPhotoPath).catch(() => {});
      }
    }

    // Handle business photos upload (multiple)
    if (req.files?.businessPhotos) {
      const uploadedPhotos = [];
      
      for (const file of req.files.businessPhotos) {
        try {
          const photoResult = await uploadToCloudinary(file.path, 'business-profiles/photos');
          if (photoResult.success) {
            uploadedPhotos.push(photoResult.url);
          }
        } catch (uploadError) {
          console.error('Business photo upload error:', uploadError);
        } finally {
          // Clean up local file
          await fs.unlink(file.path).catch(() => {});
        }
      }

      businessOwner.businessProfile.photos = uploadedPhotos;
    }

    await businessOwner.save();

    // Populate categories for response
    await businessOwner.populate('businessProfile.categories', 'name slug icon');

    res.status(201).json({
      success: true,
      message: 'Business profile created successfully',
      data: {
        businessProfile: businessOwner.businessProfile
      }
    });
  } catch (error) {
    console.error('Create business profile error:', error);
    
    // Clean up uploaded files on error
    if (req.files?.coverPhoto) {
      await fs.unlink(req.files.coverPhoto[0].path).catch(() => {});
    }
    if (req.files?.businessPhotos) {
      for (const file of req.files.businessPhotos) {
        await fs.unlink(file.path).catch(() => {});
      }
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred while creating business profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update business profile
 * PUT /api/business-owners/business-profile
 */
exports.updateBusinessProfile = async (req, res) => {
  try {
    const { name, categories, location, about } = req.body;

    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    // Check if business profile exists
    if (!businessOwner.businessProfile || 
        (!businessOwner.businessProfile.name && 
         !businessOwner.businessProfile.categories?.length)) {
      return res.status(400).json({
        success: false,
        message: 'Business profile does not exist. Use POST method to create it first.'
      });
    }

    // Handle cover photo upload
    if (req.files?.coverPhoto) {
      const coverPhotoPath = req.files.coverPhoto[0].path;
      
      // Delete old cover photo if exists
      if (businessOwner.businessProfile.coverPhoto) {
        await deleteFromCloudinary(businessOwner.businessProfile.coverPhoto).catch(() => {});
      }

      // Upload new cover photo
      const coverPhotoResult = await uploadToCloudinary(coverPhotoPath, 'business-profiles/covers');
      if (coverPhotoResult.success) {
        businessOwner.businessProfile.coverPhoto = coverPhotoResult.url;
      }

      // Clean up local file
      await fs.unlink(coverPhotoPath).catch(() => {});
    }

    // Handle business photos upload (multiple)
    if (req.files?.businessPhotos) {
      const uploadedPhotos = [];
      
      for (const file of req.files.businessPhotos) {
        const photoResult = await uploadToCloudinary(file.path, 'business-profiles/photos');
        if (photoResult.success) {
          uploadedPhotos.push(photoResult.url);
        }
        
        // Clean up local file
        await fs.unlink(file.path).catch(() => {});
      }

      // Add new photos to existing array
      if (!businessOwner.businessProfile.photos) {
        businessOwner.businessProfile.photos = [];
      }
      businessOwner.businessProfile.photos.push(...uploadedPhotos);
    }

    // Update text fields
    if (name !== undefined) {
      businessOwner.businessProfile.name = name;
    }

    if (categories !== undefined) {
      // Parse categories if it's a string (from form-data)
      const parsedCategories = typeof categories === 'string' 
        ? JSON.parse(categories) 
        : categories;
      
      businessOwner.businessProfile.categories = parsedCategories;
    }

    if (location !== undefined) {
      businessOwner.businessProfile.location = location;
    }

    if (about !== undefined) {
      businessOwner.businessProfile.about = about;
    }

    await businessOwner.save();

    // Populate categories for response
    await businessOwner.populate('businessProfile.categories', 'name slug icon');

    res.status(200).json({
      success: true,
      message: 'Business profile updated successfully',
      data: {
        businessProfile: businessOwner.businessProfile
      }
    });
  } catch (error) {
    console.error('Update business profile error:', error);
    
    // Clean up uploaded files on error
    if (req.files?.coverPhoto) {
      await fs.unlink(req.files.coverPhoto[0].path).catch(() => {});
    }
    if (req.files?.businessPhotos) {
      for (const file of req.files.businessPhotos) {
        await fs.unlink(file.path).catch(() => {});
      }
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred while updating business profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Delete business profile photo
 * DELETE /api/business-owners/business-profile/photos/:photoIndex
 */
exports.deleteBusinessProfilePhoto = async (req, res) => {
  try {
    const { photoIndex } = req.params;

    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    if (!businessOwner.businessProfile?.photos || businessOwner.businessProfile.photos.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No business photos found'
      });
    }

    const index = parseInt(photoIndex);
    if (isNaN(index) || index < 0 || index >= businessOwner.businessProfile.photos.length) {
      return res.status(400).json({
        success: false,
        message: 'Invalid photo index'
      });
    }

    // Delete photo from Cloudinary
    const photoUrl = businessOwner.businessProfile.photos[index];
    await deleteFromCloudinary(photoUrl).catch(() => {});

    // Remove photo from array
    businessOwner.businessProfile.photos.splice(index, 1);
    await businessOwner.save();

    res.status(200).json({
      success: true,
      message: 'Business photo deleted successfully',
      data: {
        photos: businessOwner.businessProfile.photos
      }
    });
  } catch (error) {
    console.error('Delete business profile photo error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting business photo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get bank information
 * GET /api/business-owners/bank-information
 */
exports.getBankInformation = async (req, res) => {
  try {
    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    const bankInformation = businessOwner.bankInformation || {};

    res.status(200).json({
      success: true,
      data: {
        bankInformation: {
          accountHolderName: bankInformation.accountHolderName,
          bankName: bankInformation.bankName,
          accountNumber: bankInformation.accountNumber,
          routingNumber: bankInformation.routingNumber,
          accountHolderType: bankInformation.accountHolderType
        }
      }
    });
  } catch (error) {
    console.error('Get bank information error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching bank information',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Save bank information
 * POST /api/business-owners/bank-information
 */
exports.saveBankInformation = async (req, res) => {
  try {
    const {
      accountHolderName,
      bankName,
      accountNumber,
      routingNumber,
      accountHolderType
    } = req.body;

    // Find the business owner
    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    // Initialize bank information if it doesn't exist
    if (!businessOwner.bankInformation) {
      businessOwner.bankInformation = {};
    }

    // Update bank information fields
    if (accountHolderName !== undefined) businessOwner.bankInformation.accountHolderName = accountHolderName;
    if (bankName !== undefined) businessOwner.bankInformation.bankName = bankName;
    if (accountNumber !== undefined) businessOwner.bankInformation.accountNumber = accountNumber;
    if (routingNumber !== undefined) businessOwner.bankInformation.routingNumber = routingNumber;
    if (accountHolderType !== undefined) businessOwner.bankInformation.accountHolderType = accountHolderType;

    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    await businessOwner.save();

    res.status(200).json({
      success: true,
      message: 'Bank information saved successfully',
      data: {
        bankInformation: {
          accountHolderName: businessOwner.bankInformation.accountHolderName,
          bankName: businessOwner.bankInformation.bankName,
          accountNumber: businessOwner.bankInformation.accountNumber,
          routingNumber: businessOwner.bankInformation.routingNumber,
          accountHolderType: businessOwner.bankInformation.accountHolderType
        }
      }
    });
  } catch (error) {
    console.error('Save bank information error:', error);

    // Clean up uploaded file if exists
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting uploaded file:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred while saving bank information',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update bank information
 * PUT /api/business-owners/bank-information
 */
exports.updateBankInformation = async (req, res) => {
  try {
    const {
      accountHolderName,
      bankName,
      accountNumber,
      routingNumber,
      accountHolderType
    } = req.body;

    // Find the business owner
    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    // Check if bank information exists
    if (!businessOwner.bankInformation) {
      return res.status(400).json({
        success: false,
        message: 'Bank information does not exist. Use POST method to create it first.'
      });
    }

    // Update bank information fields
    if (accountHolderName !== undefined) businessOwner.bankInformation.accountHolderName = accountHolderName;
    if (bankName !== undefined) businessOwner.bankInformation.bankName = bankName;
    if (accountNumber !== undefined) businessOwner.bankInformation.accountNumber = accountNumber;
    if (routingNumber !== undefined) businessOwner.bankInformation.routingNumber = routingNumber;
    if (accountHolderType !== undefined) businessOwner.bankInformation.accountHolderType = accountHolderType;

    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    await businessOwner.save();

    res.status(200).json({
      success: true,
      message: 'Bank information updated successfully',
      data: {
        bankInformation: {
          accountHolderName: businessOwner.bankInformation.accountHolderName,
          bankName: businessOwner.bankInformation.bankName,
          accountNumber: businessOwner.bankInformation.accountNumber,
          routingNumber: businessOwner.bankInformation.routingNumber,
          accountHolderType: businessOwner.bankInformation.accountHolderType
        }
      }
    });
  } catch (error) {
    console.error('Update bank information error:', error);

    // Clean up uploaded file if exists
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting uploaded file:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred while updating bank information',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Delete bank verification document
 * DELETE /api/business-owners/bank-information/document
 */
exports.deleteBankVerificationDocument = async (req, res) => {
  try {
    res.status(400).json({
      success: false,
      message: 'Bank verification documents are not supported for business owner bank information'
    });
  } catch (error) {
    console.error('Delete bank verification document error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting bank verification document',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get privacy policy (Business Owner)
 * GET /api/business-owners/privacy-policy
 */
exports.getPrivacyPolicy = async (req, res) => {
  try {
    const settings = await Settings.findOne({ key: 'privacy_policy', isActive: true })
      .select('key title content updatedAt');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Privacy policy not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        settings
      }
    });
  } catch (error) {
    console.error('Get privacy policy error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching privacy policy',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get terms and conditions (Business Owner)
 * GET /api/business-owners/terms-and-conditions
 */
exports.getTermsAndConditions = async (req, res) => {
  try {
    const settings = await Settings.findOne({ key: 'terms_and_conditions', isActive: true })
      .select('key title content updatedAt');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Terms and conditions not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        settings
      }
    });
  } catch (error) {
    console.error('Get terms and conditions error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching terms and conditions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
