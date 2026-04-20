const User = require('../models/User');
const Provider = require('../models/Provider');
const Portfolio = require('../models/Portfolio');
const RefreshToken = require('../models/RefreshToken');
const ProviderRegistrationOTP = require('../models/ProviderRegistrationOTP');
const ocrService = require('../utility/ocrService');
const { getTokenExpiresIn } = require('../utility/jwt');
const { upsertDeviceToken } = require('../utility/deviceToken');
const { sendRegistrationOTPEmail, sendOTPEmail } = require('../utility/emailService');
const { sendRegistrationOTPSMS, sendOTPSMS } = require('../utility/smsService');
const fs = require('fs').promises;
const { uploadToCloudinary, deleteFromCloudinary } = require('../utility/cloudinary');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const idCardsDir = path.join(__dirname, '../../uploads/id-cards');

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

const removePendingIdCards = async (pending) => {
  if (!pending) return;
  if (pending.idCardFrontFilename) {
    await removeFileIfExists(path.join(idCardsDir, pending.idCardFrontFilename));
  }
  if (pending.idCardBackFilename) {
    await removeFileIfExists(path.join(idCardsDir, pending.idCardBackFilename));
  }
};

const createProviderAndTokens = async (req, payload) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const user = new User({
      fullName: payload.fullName,
      email: payload.email || undefined,
      phoneNumber: payload.phoneNumber || undefined,
      password: payload.passwordHash,
      userType: 'provider',
      authProvider: 'local',
      termsAccepted: true
    });

    await user.save({ session });

    const provider = new Provider({
      userId: user._id,
      idCard: {
        frontImage: payload.idCardFrontFilename || null,
        backImage: payload.idCardBackFilename || null,
        idNumber: null,
        fullNameOnId: payload.fullName,
        dateOfBirth: null,
        expiryDate: null,
        issuedDate: null,
        nationality: null,
        address: null
      },
      occupation: payload.occupation || null,
      referenceId: payload.referenceId || null,
      verificationStatus: 'pending'
    });

    await provider.save({ session });
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
      provider,
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
 * Register a new provider
 * POST /api/providers/register
 */
exports.registerProvider = async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      confirmPassword,
      occupation,
      referenceId,
      phoneNumber
    } = req.body;

    // Validate required fields
    if (!fullName || !password) {
      return res.status(400).json({
        success: false,
        message: 'Full name and password are required'
      });
    }

    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone number is required'
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

    const normalizedEmail = email ? email.toLowerCase() : undefined;

    // Check if ID card images are uploaded (both optional now)
    // Just store the images, no OCR or validation
    const idCardFrontPath = req.files?.idCardFront ? req.files.idCardFront[0].path : null;
    const idCardBackPath = req.files?.idCardBack ? req.files.idCardBack[0].path : null;
    const idCardFrontFilename = req.files?.idCardFront ? req.files.idCardFront[0].filename : null;
    const idCardBackFilename = req.files?.idCardBack ? req.files.idCardBack[0].filename : null;

    if (idCardFrontPath) {
      console.log('ID card front uploaded (stored for records only, no validation)');
    }

    if (idCardBackPath) {
      console.log('ID card back uploaded (stored for records only, no validation)');
    }

    // Check if user already exists
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

    const identifiers = [];
    if (normalizedEmail) identifiers.push({ email: normalizedEmail });
    if (phoneNumber) identifiers.push({ phoneNumber });

    try {
      const pendingQuery = identifiers.length > 1 ? { $or: identifiers } : identifiers[0];
      const existingPending = await ProviderRegistrationOTP.findOne(pendingQuery);

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

      if (existingPending && idCardFrontFilename && existingPending.idCardFrontFilename) {
        await removeFileIfExists(path.join(idCardsDir, existingPending.idCardFrontFilename));
      }
      if (existingPending && idCardBackFilename && existingPending.idCardBackFilename) {
        await removeFileIfExists(path.join(idCardsDir, existingPending.idCardBackFilename));
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
        occupation: occupation || existingPending?.occupation || null,
        referenceId: referenceId || existingPending?.referenceId || null,
        idCardFrontFilename: idCardFrontFilename || existingPending?.idCardFrontFilename || null,
        idCardBackFilename: idCardBackFilename || existingPending?.idCardBackFilename || null,
        otpHash,
        otpExpiresAt,
        isVerified: false,
        verificationTokenHash: undefined,
        verificationTokenExpiresAt: undefined
      };

      const pending = await ProviderRegistrationOTP.findOneAndUpdate(
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
        await ProviderRegistrationOTP.deleteOne({ _id: pending._id });
        await removeFileIfExists(idCardFrontPath);
        await removeFileIfExists(idCardBackPath);
        console.error('Error sending provider registration OTP:', sendError);
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
    } catch (error) {
      throw error;
    }

  } catch (error) {
    console.error('Provider registration error:', error);

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
 * Verify provider registration OTP and create provider
 * POST /api/providers/register/verify-otp
 */
exports.verifyProviderRegistrationOTP = async (req, res) => {
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
    const pending = await ProviderRegistrationOTP.findOne(
      normalizedEmail ? { email: normalizedEmail } : { phoneNumber }
    ).select('+otpHash +otpExpiresAt +passwordHash');

    if (!pending) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    if (pending.otpExpiresAt && Date.now() > pending.otpExpiresAt.getTime()) {
      await ProviderRegistrationOTP.deleteOne({ _id: pending._id });
      await removePendingIdCards(pending);
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

    if (!pending.fullName || !pending.passwordHash) {
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
      await ProviderRegistrationOTP.deleteOne({ _id: pending._id });
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone number already exists'
      });
    }

    const authData = await createProviderAndTokens(req, {
      fullName: pending.fullName,
      email: pending.email,
      phoneNumber: pending.phoneNumber,
      passwordHash: pending.passwordHash,
      occupation: pending.occupation,
      referenceId: pending.referenceId,
      idCardFrontFilename: pending.idCardFrontFilename,
      idCardBackFilename: pending.idCardBackFilename
    });

    await ProviderRegistrationOTP.deleteOne({ _id: pending._id });

    return res.status(201).json({
      success: true,
      message: 'Provider registration successful. Your account is pending verification.',
      data: {
        user: {
          id: authData.user._id,
          fullName: authData.user.fullName,
          email: authData.user.email,
          phoneNumber: authData.user.phoneNumber,
          userType: authData.user.userType,
          authProvider: authData.user.authProvider
        },
        provider: {
          id: authData.provider._id,
          verificationStatus: authData.provider.verificationStatus,
          occupation: authData.provider.occupation,
          referenceId: authData.provider.referenceId,
          idCardUploaded: {
            front: !!authData.provider.idCard?.frontImage,
            back: !!authData.provider.idCard?.backImage
          }
        },
        accessToken: authData.accessToken,
        refreshToken: authData.refreshToken,
        expiresIn: authData.accessExpiresIn,
        tokenType: 'Bearer'
      }
    });
  } catch (error) {
    console.error('Verify provider OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Login provider
 * POST /api/providers/login
 */
exports.loginProvider = async (req, res) => {
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
      userType: 'provider' // Only allow providers to login through this endpoint
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

    // Get provider profile
    const provider = await Provider.findOne({ userId: user._id });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    // Check verification status
    if (provider.verificationStatus === 'rejected') {
      return res.status(403).json({
        success: false,
        message: 'Your provider account has been rejected. Please contact support.',
        verificationNotes: provider.verificationNotes
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
        console.error('Register device token on provider login error:', tokenError);
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
        provider: {
          id: provider._id,
          verificationStatus: provider.verificationStatus,
          occupation: provider.occupation,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
          completedJobs: provider.completedJobs,
          isAvailable: provider.isAvailable
        },
        accessToken,
        refreshToken,
        expiresIn: accessExpiresIn,
        tokenType: 'Bearer'
      }
    });

  } catch (error) {
    console.error('Provider login error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during login',
      error: error.message
    });
  }
};

/**
 * Logout provider
 * POST /api/providers/logout
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
    console.error('Provider logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout',
      error: error.message
    });
  }
};

/**
 * Logout provider from all devices
 * POST /api/providers/logout-all
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
    console.error('Provider logout all error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout',
      error: error.message
    });
  }
};

/**
 * Get provider profile
 * GET /api/providers/me
 */
exports.getProviderProfile = async (req, res) => {
  try {
    // User is already attached to req by auth middleware
    const provider = await Provider.findOne({ userId: req.user._id })
      .populate('userId', '-password -resetPasswordOTP -resetPasswordOTPExpires');

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        provider
      }
    });

  } catch (error) {
    console.error('Get provider profile error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching provider profile',
      error: error.message
    });
  }
};

/**
 * Update provider profile
 * PUT /api/providers/me
 */
exports.updateProviderProfile = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phoneNumber,
      occupation,
      servicesOffered,
      isAvailable
    } = req.body;

    const userId = req.user._id;

    // Find user and provider
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const provider = await Provider.findOne({ userId: userId });
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
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

    // Update location if provided
    const { latitude, longitude, address, activityTime } = req.body;
    if (latitude !== undefined && longitude !== undefined) {
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);

      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid latitude or longitude'
        });
      }

      user.location = {
        type: 'Point',
        coordinates: [lon, lat], // [longitude, latitude] - GeoJSON format
        address: address || user.location?.address || ''
      };
    } else if (address) {
      // Update only address if coordinates not provided
      if (!user.location) {
        user.location = {
          type: 'Point',
          coordinates: [0, 0],
          address: address
        };
      } else {
        user.location.address = address;
      }
    }

    // Update activity time in provider
    if (activityTime !== undefined) provider.activityTime = activityTime;

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

    // Update provider-specific fields
    if (occupation !== undefined) provider.occupation = occupation;
    if (servicesOffered !== undefined) provider.servicesOffered = servicesOffered;
    if (isAvailable !== undefined) provider.isAvailable = isAvailable;

    await provider.save();

    // Fetch updated provider with populated user data
    const updatedProvider = await Provider.findOne({ userId: userId })
      .populate('userId', '-password -resetPasswordOTP -resetPasswordOTPExpires');

    res.status(200).json({
      success: true,
      message: 'Provider profile updated successfully',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          profilePicture: user.profilePicture,
          userType: user.userType,
          location: user.location ? {
            latitude: user.location.coordinates[1],
            longitude: user.location.coordinates[0],
            address: user.location.address,
            coordinates: user.location.coordinates
          } : null
        },
        provider: {
          id: provider._id,
          occupation: provider.occupation,
          servicesOffered: provider.servicesOffered,
          isAvailable: provider.isAvailable,
          verificationStatus: provider.verificationStatus,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
          completedJobs: provider.completedJobs,
          activityTime: provider.activityTime
        }
      }
    });

  } catch (error) {
    console.error('Update provider profile error:', error);

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
      message: 'An error occurred while updating provider profile',
      error: error.message
    });
  }
};

/**
 * Forgot password - Send OTP to email or phone
 * POST /api/providers/forgot-password
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email, phoneNumber } = req.body;

    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone number is required'
      });
    }

    const query = email ? { email: email.toLowerCase() } : { phoneNumber };
    const user = await User.findOne({
      ...query,
      userType: 'provider'
    });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If a provider account exists with this information, you will receive an OTP shortly.'
      });
    }

    const provider = await Provider.findOne({ userId: user._id });
    if (!provider) {
      return res.status(200).json({
        success: true,
        message: 'If a provider account exists with this information, you will receive an OTP shortly.'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    const otp = user.generatePasswordResetOTP();
    await user.save({ validateBeforeSave: false });

    try {
      if (email && user.email) {
        await sendOTPEmail(user.email, otp, user.fullName);
      } else if (phoneNumber && user.phoneNumber) {
        await sendOTPSMS(user.phoneNumber, otp, user.fullName);
      }

      res.status(200).json({
        success: true,
        message: `OTP has been sent to your ${email ? 'email' : 'phone number'}. Please check and enter the code.`,
        data: {
          sentTo: email ? 'email' : 'phone',
          expiresIn: '10 minutes'
        }
      });
    } catch (sendError) {
      user.resetPasswordOTP = undefined;
      user.resetPasswordOTPExpires = undefined;
      await user.save({ validateBeforeSave: false });

      console.error('Error sending provider OTP:', sendError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again later.',
        error: process.env.NODE_ENV === 'development' ? sendError.message : undefined
      });
    }
  } catch (error) {
    console.error('Provider forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while processing your request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Verify OTP
 * POST /api/providers/verify-otp
 */
exports.verifyOTP = async (req, res) => {
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

    const query = email ? { email: email.toLowerCase() } : { phoneNumber };
    const user = await User.findOne({
      ...query,
      userType: 'provider'
    }).select('+resetPasswordOTP +resetPasswordOTPExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    const provider = await Provider.findOne({ userId: user._id });
    if (!provider) {
      return res.status(400).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    const isValid = user.verifyPasswordResetOTP(otp);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please request a new one.'
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    user.resetPasswordTokenExpires = Date.now() + 10 * 60 * 1000;
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You can now reset your password.',
      data: {
        resetToken,
        expiresIn: '10 minutes'
      }
    });
  } catch (error) {
    console.error('Provider verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while verifying OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Reset password with token
 * POST /api/providers/reset-password
 */
exports.resetPasswordWithOTP = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken) {
      return res.status(400).json({
        success: false,
        message: 'Reset token is required'
      });
    }

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password is required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordTokenExpires: { $gt: Date.now() },
      userType: 'provider'
    }).select('+resetPasswordToken +resetPasswordTokenExpires +password');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token. Please verify OTP again.'
      });
    }

    const provider = await Provider.findOne({ userId: user._id });
    if (!provider) {
      return res.status(400).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordTokenExpires = undefined;
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpires = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('Provider reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while resetting password',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Change provider password
 * POST /api/providers/change-password
 */
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'All password fields are required'
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

    // Find user with password field
    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
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
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password',
      error: error.message
    });
  }
};

/**
 * Add portfolio item
 * POST /api/providers/portfolio
 */
exports.addPortfolioItem = async (req, res) => {
  try {
    const { title, about, serviceType, displayOrder } = req.body;
    const userId = req.user._id;

    // Find provider
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      // Clean up uploaded files
      if (req.files) {
        if (req.files.beforeImage) await fs.unlink(req.files.beforeImage[0].path).catch(() => {});
        if (req.files.afterImage) await fs.unlink(req.files.afterImage[0].path).catch(() => {});
      }
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    // Validate required fields
    if (!title || !about) {
      if (req.files) {
        if (req.files.beforeImage) await fs.unlink(req.files.beforeImage[0].path).catch(() => {});
        if (req.files.afterImage) await fs.unlink(req.files.afterImage[0].path).catch(() => {});
      }
      return res.status(400).json({
        success: false,
        message: 'Title and description are required'
      });
    }

    // Validate images
    if (!req.files || !req.files.beforeImage || !req.files.afterImage) {
      if (req.files) {
        if (req.files.beforeImage) await fs.unlink(req.files.beforeImage[0].path).catch(() => {});
        if (req.files.afterImage) await fs.unlink(req.files.afterImage[0].path).catch(() => {});
      }
      return res.status(400).json({
        success: false,
        message: 'Both before and after images are required'
      });
    }

    // Upload images to Cloudinary
    let beforeImageUrl, afterImageUrl;

    try {
      const beforeUpload = await uploadToCloudinary(req.files.beforeImage[0].path, 'portfolio');
      const afterUpload = await uploadToCloudinary(req.files.afterImage[0].path, 'portfolio');

      if (!beforeUpload.success || !afterUpload.success) {
        throw new Error('Failed to upload images');
      }

      beforeImageUrl = beforeUpload.url;
      afterImageUrl = afterUpload.url;

      // Delete local files after upload
      await fs.unlink(req.files.beforeImage[0].path).catch(() => {});
      await fs.unlink(req.files.afterImage[0].path).catch(() => {});
    } catch (uploadError) {
      // Clean up local files
      if (req.files.beforeImage) await fs.unlink(req.files.beforeImage[0].path).catch(() => {});
      if (req.files.afterImage) await fs.unlink(req.files.afterImage[0].path).catch(() => {});

      return res.status(500).json({
        success: false,
        message: 'Failed to upload images',
        error: uploadError.message
      });
    }

    // Create portfolio item
    const portfolio = new Portfolio({
      providerId: provider._id,
      title,
      beforeImage: beforeImageUrl,
      afterImage: afterImageUrl,
      about,
      serviceType: serviceType || null,
      displayOrder: displayOrder || 0
    });

    await portfolio.save();

    res.status(201).json({
      success: true,
      message: 'Portfolio item added successfully',
      data: {
        portfolio
      }
    });

  } catch (error) {
    console.error('Add portfolio item error:', error);

    // Clean up uploaded files on error
    if (req.files) {
      if (req.files.beforeImage) await fs.unlink(req.files.beforeImage[0].path).catch(() => {});
      if (req.files.afterImage) await fs.unlink(req.files.afterImage[0].path).catch(() => {});
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred while adding portfolio item',
      error: error.message
    });
  }
};

/**
 * Get all portfolio items for current provider
 * GET /api/providers/portfolio
 */
exports.getMyPortfolio = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find provider
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    // Get portfolio items
    const portfolioItems = await Portfolio.find({
      providerId: provider._id,
      isActive: true
    }).sort({ displayOrder: 1, createdAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        portfolio: portfolioItems,
        count: portfolioItems.length
      }
    });

  } catch (error) {
    console.error('Get portfolio error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching portfolio',
      error: error.message
    });
  }
};

/**
 * Get single portfolio item
 * GET /api/providers/portfolio/:id
 */
exports.getPortfolioItem = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    // Find provider
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    // Get portfolio item
    const portfolio = await Portfolio.findOne({
      _id: id,
      providerId: provider._id
    });

    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio item not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        portfolio
      }
    });

  } catch (error) {
    console.error('Get portfolio item error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching portfolio item',
      error: error.message
    });
  }
};

/**
 * Update portfolio item
 * PUT /api/providers/portfolio/:id
 */
exports.updatePortfolioItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, about, serviceType, displayOrder, isActive } = req.body;
    const userId = req.user._id;

    // Find provider
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      if (req.files) {
        if (req.files.beforeImage) await fs.unlink(req.files.beforeImage[0].path).catch(() => {});
        if (req.files.afterImage) await fs.unlink(req.files.afterImage[0].path).catch(() => {});
      }
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    // Find portfolio item
    const portfolio = await Portfolio.findOne({
      _id: id,
      providerId: provider._id
    });

    if (!portfolio) {
      if (req.files) {
        if (req.files.beforeImage) await fs.unlink(req.files.beforeImage[0].path).catch(() => {});
        if (req.files.afterImage) await fs.unlink(req.files.afterImage[0].path).catch(() => {});
      }
      return res.status(404).json({
        success: false,
        message: 'Portfolio item not found'
      });
    }

    // Update text fields
    if (title !== undefined) portfolio.title = title;
    if (about !== undefined) portfolio.about = about;
    if (serviceType !== undefined) portfolio.serviceType = serviceType;
    if (displayOrder !== undefined) portfolio.displayOrder = displayOrder;
    if (isActive !== undefined) portfolio.isActive = isActive;

    // Update images if provided
    if (req.files) {
      try {
        if (req.files.beforeImage) {
          // Upload new before image
          const beforeUpload = await uploadToCloudinary(req.files.beforeImage[0].path, 'portfolio');
          if (beforeUpload.success) {
            // Delete old image from Cloudinary
            if (portfolio.beforeImage) {
              const urlParts = portfolio.beforeImage.split('/');
              const publicIdWithExtension = urlParts.slice(-2).join('/');
              const publicId = publicIdWithExtension.split('.')[0];
              await deleteFromCloudinary(publicId);
            }
            portfolio.beforeImage = beforeUpload.url;
          }
          await fs.unlink(req.files.beforeImage[0].path).catch(() => {});
        }

        if (req.files.afterImage) {
          // Upload new after image
          const afterUpload = await uploadToCloudinary(req.files.afterImage[0].path, 'portfolio');
          if (afterUpload.success) {
            // Delete old image from Cloudinary
            if (portfolio.afterImage) {
              const urlParts = portfolio.afterImage.split('/');
              const publicIdWithExtension = urlParts.slice(-2).join('/');
              const publicId = publicIdWithExtension.split('.')[0];
              await deleteFromCloudinary(publicId);
            }
            portfolio.afterImage = afterUpload.url;
          }
          await fs.unlink(req.files.afterImage[0].path).catch(() => {});
        }
      } catch (uploadError) {
        console.error('Image upload error during update:', uploadError);
        // Continue with text field updates even if image upload fails
      }
    }

    await portfolio.save();

    res.status(200).json({
      success: true,
      message: 'Portfolio item updated successfully',
      data: {
        portfolio
      }
    });

  } catch (error) {
    console.error('Update portfolio item error:', error);

    if (req.files) {
      if (req.files.beforeImage) await fs.unlink(req.files.beforeImage[0].path).catch(() => {});
      if (req.files.afterImage) await fs.unlink(req.files.afterImage[0].path).catch(() => {});
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred while updating portfolio item',
      error: error.message
    });
  }
};

/**
 * Delete portfolio item
 * DELETE /api/providers/portfolio/:id
 */
exports.deletePortfolioItem = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    // Find provider
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    // Find and delete portfolio item
    const portfolio = await Portfolio.findOneAndDelete({
      _id: id,
      providerId: provider._id
    });

    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio item not found'
      });
    }

    // Delete images from Cloudinary
    try {
      if (portfolio.beforeImage) {
        const urlParts = portfolio.beforeImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      }

      if (portfolio.afterImage) {
        const urlParts = portfolio.afterImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      }
    } catch (deleteError) {
      console.error('Error deleting images from Cloudinary:', deleteError);
      // Continue even if image deletion fails
    }

    res.status(200).json({
      success: true,
      message: 'Portfolio item deleted successfully'
    });

  } catch (error) {
    console.error('Delete portfolio item error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting portfolio item',
      error: error.message
    });
  }
};

/**
 * Get public portfolio for a provider (for users to view)
 * GET /api/providers/:providerId/portfolio
 */
exports.getProviderPortfolio = async (req, res) => {
  try {
    const { providerId } = req.params;

    // Get active portfolio items
    const portfolioItems = await Portfolio.find({
      providerId,
      isActive: true
    }).sort({ displayOrder: 1, createdAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        portfolio: portfolioItems,
        count: portfolioItems.length
      }
    });

  } catch (error) {
    console.error('Get provider portfolio error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching provider portfolio',
      error: error.message
    });
  }
};
