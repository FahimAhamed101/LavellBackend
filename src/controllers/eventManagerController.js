const User = require('../models/User');
const EventManager = require('../models/EventManager');
const RefreshToken = require('../models/RefreshToken');
const EventManagerRegistrationOTP = require('../models/EventManagerRegistrationOTP');
const Notification = require('../models/Notification');
const { getTokenExpiresIn } = require('../utility/jwt');
const { upsertDeviceToken } = require('../utility/deviceToken');
const fs = require('fs').promises;
const { uploadToCloudinary, deleteFromCloudinary } = require('../utility/cloudinary');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sendOTPEmail, sendRegistrationOTPEmail } = require('../utility/emailService');
const { sendRegistrationOTPSMS } = require('../utility/smsService');
const Settings = require('../models/Settings');
const EventTicketPurchase = require('../models/EventTicketPurchase');

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
const hashValue = (value) => crypto.createHash('sha256').update(value).digest('hex');

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

const removePendingEventManagerAssets = async (pending) => {
  if (!pending) return;
  await removeCloudinaryIfExists(pending.idCardFrontPublicId);
  await removeCloudinaryIfExists(pending.idCardBackPublicId);
};

const createEventManagerAndTokens = async (req, payload) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const user = new User({
      fullName: payload.fullName,
      email: payload.email || undefined,
      phoneNumber: payload.phoneNumber || undefined,
      password: payload.passwordHash,
      userType: 'eventManager',
      authProvider: 'local',
      termsAccepted: true
    });

    await user.save({ session });

    const eventManager = new EventManager({
      userId: user._id,
      dateOfBirth: payload.dateOfBirth,
      idType: payload.idType,
      identificationNumber: payload.identificationNumber,
      idCard: {
        frontImage: payload.idCardFrontUrl || null,
        backImage: payload.idCardBackUrl || null
      }
    });

    await eventManager.save({ session });

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
      eventManager,
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
 * Register a new event manager
 * POST /api/event-managers/register
 */
exports.registerEventManager = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phoneNumber,
      password,
      confirmPassword,
      dateOfBirth,
      idType,
      identificationNumber
    } = req.body;

    // Validate required fields
    if (!fullName || !password) {
      return res.status(400).json({
        success: false,
        message: 'Full name and password are required'
      });
    }

    if (!dateOfBirth || !idType || !identificationNumber) {
      return res.status(400).json({
        success: false,
        message: 'Date of birth, ID type, and identification number are required'
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

    // Validate ID type
    const validIdTypes = ['passport', 'national_id', 'driver_license'];
    if (!validIdTypes.includes(idType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID type. Must be passport, national_id, or driver_license'
      });
    }

    // Validate date of birth
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

    // Get ID card image paths
    const idCardFrontPath = req.files?.idCardFront ? req.files.idCardFront[0].path : null;
    const idCardBackPath = req.files?.idCardBack ? req.files.idCardBack[0].path : null;

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

      return res.status(400).json({
        success: false,
        message: 'User with this email or phone number already exists'
      });
    }

    // Upload ID card images to Cloudinary
    let frontImageUrl = null;
    let backImageUrl = null;
    let frontImagePublicId = null;
    let backImagePublicId = null;

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

    try {
      const identifiers = [];
      if (normalizedEmail) identifiers.push({ email: normalizedEmail });
      if (phoneNumber) identifiers.push({ phoneNumber });

      const pendingQuery = identifiers.length > 1 ? { $or: identifiers } : identifiers[0];
      const existingPending = await EventManagerRegistrationOTP.findOne(pendingQuery);

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
        dateOfBirth: dob,
        idType: idType || existingPending?.idType,
        identificationNumber: identificationNumber || existingPending?.identificationNumber,
        idCardFrontUrl: frontImageUrl || existingPending?.idCardFrontUrl || null,
        idCardFrontPublicId: frontImagePublicId || existingPending?.idCardFrontPublicId || null,
        idCardBackUrl: backImageUrl || existingPending?.idCardBackUrl || null,
        idCardBackPublicId: backImagePublicId || existingPending?.idCardBackPublicId || null,
        otpHash,
        otpExpiresAt,
        isVerified: false,
        verificationTokenHash: undefined,
        verificationTokenExpiresAt: undefined
      };

      const pending = await EventManagerRegistrationOTP.findOneAndUpdate(
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
        await EventManagerRegistrationOTP.deleteOne({ _id: pending._id });
        await removeCloudinaryIfExists(frontImagePublicId);
        await removeCloudinaryIfExists(backImagePublicId);
        console.error('Error sending event manager registration OTP:', sendError);
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
    console.error('Event manager registration error:', error);

    // Clean up uploaded files on error
    if (req.files) {
      if (req.files.idCardFront) {
        await removeFileIfExists(req.files.idCardFront[0].path);
      }
      if (req.files.idCardBack) {
        await removeFileIfExists(req.files.idCardBack[0].path);
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
 * Verify event manager registration OTP and create event manager
 * POST /api/event-managers/register/verify-otp
 */
exports.verifyEventManagerRegistrationOTP = async (req, res) => {
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
    const pending = await EventManagerRegistrationOTP.findOne(
      normalizedEmail ? { email: normalizedEmail } : { phoneNumber }
    ).select('+otpHash +otpExpiresAt +passwordHash');

    if (!pending) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    if (pending.otpExpiresAt && Date.now() > pending.otpExpiresAt.getTime()) {
      await EventManagerRegistrationOTP.deleteOne({ _id: pending._id });
      await removePendingEventManagerAssets(pending);
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
      !pending.dateOfBirth ||
      !pending.idType ||
      !pending.identificationNumber
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
      await EventManagerRegistrationOTP.deleteOne({ _id: pending._id });
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone number already exists'
      });
    }

    const authData = await createEventManagerAndTokens(req, {
      fullName: pending.fullName,
      email: pending.email,
      phoneNumber: pending.phoneNumber,
      passwordHash: pending.passwordHash,
      dateOfBirth: pending.dateOfBirth,
      idType: pending.idType,
      identificationNumber: pending.identificationNumber,
      idCardFrontUrl: pending.idCardFrontUrl,
      idCardBackUrl: pending.idCardBackUrl
    });

    await EventManagerRegistrationOTP.deleteOne({ _id: pending._id });

    return res.status(201).json({
      success: true,
      message: 'Event manager registration successful',
      data: {
        user: {
          id: authData.user._id,
          fullName: authData.user.fullName,
          email: authData.user.email,
          phoneNumber: authData.user.phoneNumber,
          userType: authData.user.userType,
          authProvider: authData.user.authProvider
        },
        eventManager: {
          id: authData.eventManager._id,
          dateOfBirth: authData.eventManager.dateOfBirth,
          idType: authData.eventManager.idType,
          identificationNumber: authData.eventManager.identificationNumber,
          idCardUploaded: {
            front: !!authData.eventManager.idCard?.frontImage,
            back: !!authData.eventManager.idCard?.backImage
          }
        },
        accessToken: authData.accessToken,
        refreshToken: authData.refreshToken,
        expiresIn: authData.accessExpiresIn,
        tokenType: 'Bearer'
      }
    });
  } catch (error) {
    console.error('Verify event manager OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Login event manager
 * POST /api/event-managers/login
 */
exports.loginEventManager = async (req, res) => {
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
      userType: 'eventManager' // Only allow event managers to login through this endpoint
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

    // Get event manager profile
    const eventManager = await EventManager.findOne({ userId: user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
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
        console.error('Register device token on event manager login error:', tokenError);
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
        eventManager: {
          id: eventManager._id,
          dateOfBirth: eventManager.dateOfBirth,
          idType: eventManager.idType,
          identificationNumber: eventManager.identificationNumber
        },
        accessToken,
        refreshToken,
        expiresIn: accessExpiresIn,
        tokenType: 'Bearer'
      }
    });

  } catch (error) {
    console.error('Event manager login error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during login',
      error: error.message
    });
  }
};

/**
 * Logout event manager
 * POST /api/event-managers/logout
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
    console.error('Event manager logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout',
      error: error.message
    });
  }
};

/**
 * Logout event manager from all devices
 * POST /api/event-managers/logout-all
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
    console.error('Event manager logout all error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout',
      error: error.message
    });
  }
};

/**
 * Delete event manager account (self)
 * DELETE /api/event-managers/me
 */
exports.deleteEventManagerAccount = async (req, res) => {
  try {
    const userId = req.user._id;

    const eventManager = await EventManager.findOne({ userId });
    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    // Delete ID card images from Cloudinary if they exist
    if (eventManager.idCard?.frontImage) {
      try {
        const urlParts = eventManager.idCard.frontImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting front ID card image:', err);
      }
    }

    if (eventManager.idCard?.backImage) {
      try {
        const urlParts = eventManager.idCard.backImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting back ID card image:', err);
      }
    }

    const user = await User.findById(userId);
    if (user?.profilePicture) {
      try {
        const urlParts = user.profilePicture.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting profile picture:', err);
      }
    }

    await EventManager.findByIdAndDelete(eventManager._id);
    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: 'Event manager account deleted permanently'
    });
  } catch (error) {
    console.error('Delete event manager account error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting event manager account',
      error: error.message
    });
  }
};

/**
 * Get event manager profile
 * GET /api/event-managers/me
 */
exports.getEventManagerProfile = async (req, res) => {
  try {
    // User is already attached to req by auth middleware
    const eventManager = await EventManager.findOne({ userId: req.user._id })
      .populate('userId', '-password -resetPasswordOTP -resetPasswordOTPExpires');

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        eventManager
      }
    });

  } catch (error) {
    console.error('Get event manager profile error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching event manager profile',
      error: error.message
    });
  }
};

/**
 * Update event manager profile
 * PUT /api/event-managers/me
 */
exports.updateEventManagerProfile = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phoneNumber,
      dateOfBirth,
      birthdate,
      category,
      businessAddress,
      currentPassword,
      newPassword,
      confirmPassword
    } = req.body;

    const userId = req.user._id;

    // Find user and event manager
    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const eventManager = await EventManager.findOne({ userId: userId });
    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
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

    // Update event manager specific fields
    const dobInput = dateOfBirth || birthdate;
    if (dobInput) {
      const dob = new Date(dobInput);
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
      eventManager.dateOfBirth = dob;
    }
    if (category !== undefined) {
      eventManager.category = category;
    }
    if (businessAddress !== undefined) {
      eventManager.businessAddress = businessAddress;
    }

    await eventManager.save();

    res.status(200).json({
      success: true,
      message: 'Event manager profile updated successfully',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          profilePicture: user.profilePicture,
          userType: user.userType
        },
        eventManager: {
          id: eventManager._id,
          dateOfBirth: eventManager.dateOfBirth,
          idType: eventManager.idType,
          identificationNumber: eventManager.identificationNumber,
          category: eventManager.category,
          businessAddress: eventManager.businessAddress
        }
      }
    });

  } catch (error) {
    console.error('Update event manager profile error:', error);

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
      message: 'An error occurred while updating event manager profile',
      error: error.message
    });
  }
};

/**
 * Get event manager bank information
 * GET /api/event-managers/bank-information
 */
exports.getBankInformation = async (req, res) => {
  try {
    const eventManager = await EventManager.findOne({ userId: req.user._id }).select('_id');
    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const user = await User.findById(req.user._id).select('bankInformation');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        bankInformation: user.bankInformation || null
      }
    });
  } catch (error) {
    console.error('Get event manager bank information error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching bank information',
      error: error.message
    });
  }
};

/**
 * Save event manager bank information
 * POST /api/event-managers/bank-information
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

    if (!accountHolderName || !bankName || !accountNumber || !routingNumber || !accountHolderType) {
      return res.status(400).json({
        success: false,
        message: 'All bank information fields are required'
      });
    }

    const eventManager = await EventManager.findOne({ userId: req.user._id }).select('_id');
    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.bankInformation = {
      accountHolderName,
      bankName,
      accountNumber,
      routingNumber,
      accountHolderType
    };

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Bank information saved successfully',
      data: {
        bankInformation: user.bankInformation
      }
    });
  } catch (error) {
    console.error('Save event manager bank information error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while saving bank information',
      error: error.message
    });
  }
};

/**
 * Update event manager bank information
 * PUT /api/event-managers/bank-information
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

    const eventManager = await EventManager.findOne({ userId: req.user._id }).select('_id');
    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.bankInformation) {
      user.bankInformation = {};
    }

    if (accountHolderName !== undefined) user.bankInformation.accountHolderName = accountHolderName;
    if (bankName !== undefined) user.bankInformation.bankName = bankName;
    if (accountNumber !== undefined) user.bankInformation.accountNumber = accountNumber;
    if (routingNumber !== undefined) user.bankInformation.routingNumber = routingNumber;
    if (accountHolderType !== undefined) user.bankInformation.accountHolderType = accountHolderType;

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Bank information updated successfully',
      data: {
        bankInformation: user.bankInformation
      }
    });
  } catch (error) {
    console.error('Update event manager bank information error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating bank information',
      error: error.message
    });
  }
};

/**
 * Forgot password - Send OTP to email
 * POST /api/event-managers/forgot-password
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

    // Find event manager user by email
    const user = await User.findOne({
      email: email.toLowerCase(),
      userType: 'eventManager'
    });

    if (!user) {
      // For security, don't reveal if user exists or not
      return res.status(200).json({
        success: true,
        message: 'If an event manager account exists with this email, you will receive an OTP shortly.'
      });
    }

    // Check if event manager profile exists
    const eventManager = await EventManager.findOne({ userId: user._id });
    if (!eventManager) {
      return res.status(200).json({
        success: true,
        message: 'If an event manager account exists with this email, you will receive an OTP shortly.'
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
      console.log(`Password reset OTP sent to event manager email: ${user.email}`);

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
 * POST /api/event-managers/verify-otp
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

    // Find event manager user with OTP fields
    const user = await User.findOne({
      email: email.toLowerCase(),
      userType: 'eventManager'
    }).select('+resetPasswordOTP +resetPasswordOTPExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    // Verify event manager profile exists
    const eventManager = await EventManager.findOne({ userId: user._id });
    if (!eventManager) {
      return res.status(400).json({
        success: false,
        message: 'Event manager profile not found'
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
 * POST /api/event-managers/reset-password
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

    // Find event manager user with OTP fields and password
    const user = await User.findOne({
      email: email.toLowerCase(),
      userType: 'eventManager'
    }).select('+resetPasswordOTP +resetPasswordOTPExpires +password');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    // Verify event manager profile exists
    const eventManager = await EventManager.findOne({ userId: user._id });
    if (!eventManager) {
      return res.status(400).json({
        success: false,
        message: 'Event manager profile not found'
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
 * Get event manager notifications
 * GET /api/event-managers/notifications
 */
exports.getNotifications = async (req, res) => {
  try {
    const { isRead, page = 1, limit = 20 } = req.query;
    const query = {
      userId: req.user._id,
      userType: 'eventManager'
    };

    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Notification.countDocuments(query),
      Notification.countDocuments({
        userId: req.user._id,
        userType: 'eventManager',
        isRead: false
      })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        notifications,
        total,
        unreadCount,
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Get event manager notifications error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching event manager notifications',
      error: error.message
    });
  }
};

/**
 * Mark one event manager notification as read
 * PATCH /api/event-managers/notifications/:id/read
 */
exports.markNotificationAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findOne({
      _id: id,
      userId: req.user._id,
      userType: 'eventManager'
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    notification.isRead = true;
    await notification.save();

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: { notification }
    });
  } catch (error) {
    console.error('Mark event manager notification as read error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error marking notification as read',
      error: error.message
    });
  }
};

/**
 * Mark all event manager notifications as read
 * PATCH /api/event-managers/notifications/read-all
 */
exports.markAllNotificationsAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      {
        userId: req.user._id,
        userType: 'eventManager',
        isRead: false
      },
      { $set: { isRead: true } }
    );

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all event manager notifications as read error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error marking notifications as read',
      error: error.message
    });
  }
};

/**
 * Delete one event manager notification
 * DELETE /api/event-managers/notifications/:id
 */
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOneAndDelete({
      _id: id,
      userId: req.user._id,
      userType: 'eventManager'
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete event manager notification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting notification',
      error: error.message
    });
  }
};

/**
 * Get event manager transaction history
 * GET /api/event-managers/transactions
 */
exports.getTransactions = async (req, res) => {
  try {
    const {
      status,
      page = 1,
      limit = 20,
      search,
      from,
      to
    } = req.query;

    const eventManager = await EventManager.findOne({ userId: req.user._id }).select('_id userId');
    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const ownerIds = [];
    if (eventManager._id) ownerIds.push(eventManager._id.toString());
    if (eventManager.userId) ownerIds.push(eventManager.userId.toString());
    const uniqueOwnerIds = Array.from(new Set(ownerIds));

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const query = {
      eventManagerId: uniqueOwnerIds.length > 1 ? { $in: uniqueOwnerIds } : uniqueOwnerIds[0]
    };

    if (status) {
      query.paymentStatus = status;
    }

    const createdAt = {};
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) {
        createdAt.$gte = fromDate;
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        createdAt.$lte = toDate;
      }
    }
    if (Object.keys(createdAt).length) {
      query.createdAt = createdAt;
    }

    const purchases = await EventTicketPurchase.find(query)
      .populate('userId', 'fullName email phoneNumber')
      .populate('eventId', 'eventName eventLocation eventStartDateTime eventEndDateTime ticketPrice')
      .sort({ createdAt: -1 });

    const searchText = typeof search === 'string' ? search.trim().toLowerCase() : '';
    const filtered = searchText
      ? purchases.filter((item) => {
          const buyerName = (item.userId?.fullName || '').toLowerCase();
          const buyerEmail = (item.userId?.email || '').toLowerCase();
          const eventName = (item.eventId?.eventName || '').toLowerCase();
          const paymentIntentId = (item.paymentIntentId || '').toLowerCase();
          const checkoutSessionId = (item.checkoutSessionId || '').toLowerCase();

          return (
            buyerName.includes(searchText) ||
            buyerEmail.includes(searchText) ||
            eventName.includes(searchText) ||
            paymentIntentId.includes(searchText) ||
            checkoutSessionId.includes(searchText)
          );
        })
      : purchases;

    const transactions = filtered.map((item) => ({
      source: 'event_ticket',
      orderId: item._id,
      transactionId: item.paymentIntentId || item.checkoutSessionId || null,
      paymentIntentId: item.paymentIntentId || null,
      checkoutSessionId: item.checkoutSessionId || null,
      buyerName: item.userId?.fullName || null,
      buyerEmail: item.userId?.email || null,
      event: {
        id: item.eventId?._id || null,
        name: item.eventId?.eventName || null,
        location: item.eventId?.eventLocation || null,
        startDateTime: item.eventId?.eventStartDateTime || null,
        endDateTime: item.eventId?.eventEndDateTime || null
      },
      quantity: item.quantity,
      ticketPrice: item.ticketPrice,
      amount: item.totalAmount,
      platformFee: item.platformFee,
      payout: item.eventManagerPayout,
      paymentStatus: item.paymentStatus,
      paymentIntentStatus: item.paymentIntentStatus,
      paidAt: item.paidAt || null,
      createdAt: item.createdAt
    }));

    const total = transactions.length;
    const totalPages = Math.ceil(total / limitNum);
    const start = (pageNum - 1) * limitNum;
    const pageData = transactions.slice(start, start + limitNum);

    return res.status(200).json({
      success: true,
      data: {
        transactions: pageData,
        total,
        currentPage: pageNum,
        totalPages,
        filters: {
          status: status || null,
          search: searchText || null,
          from: from || null,
          to: to || null
        }
      }
    });
  } catch (error) {
    console.error('Get event manager transactions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching event manager transactions',
      error: error.message
    });
  }
};

/**
 * Get privacy policy (Event Manager)
 * GET /api/event-managers/privacy-policy
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
 * Get terms and conditions (Event Manager)
 * GET /api/event-managers/terms-and-conditions
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
