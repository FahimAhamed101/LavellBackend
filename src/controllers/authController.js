const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { generateToken, getTokenExpiresIn } = require('../utility/jwt');
const { upsertDeviceToken } = require('../utility/deviceToken');
const { requestRegistrationOTP } = require('./registrationOTPController');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utility/cloudinary');
const fs = require('fs').promises;
const crypto = require('crypto');


// Register user
const register = async (req, res) => {
  try {
    // Log request body for debugging (remove in production)
   

    const { fullName, email, phoneNumber, password, termsAccepted } = req.body;

    if (!fullName || !password) {
      return res.status(400).json({
        success: false,
        message: 'Full name and password are required'
      });
    }

    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone number is required'
      });
    }

    if (!termsAccepted || termsAccepted !== true) {
      return res.status(400).json({
        success: false,
        message: 'You must accept the terms and conditions'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    return requestRegistrationOTP(req, res);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error in registration',
      error: error.message
    });
  }
};

// Login user
const login = async (req, res) => {
  try {
    // Log request body for debugging (remove in production)
    console.log('Login request body:', req.body);

    const { email, phoneNumber, password, fcmToken, platform } = req.body;

    // Validate that at least email or phoneNumber is provided
    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone number is required'
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required'
      });
    }

    // Build query to find user by email or phone
    const query = {};
    if (email) query.email = email;
    if (phoneNumber) query.phoneNumber = phoneNumber;

    // Find user by email or phone - need to select password explicitly
    const user = await User.findOne(email ? { email } : { phoneNumber }).select('+password');

    if (!user) {
      return res.status(400).json({
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

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
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
        console.error('Register device token on login error:', tokenError);
      }
    }

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          userType: user.userType
        },
        accessToken,
        refreshToken,
        expiresIn: accessExpiresIn,
        tokenType: 'Bearer'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error in login',
      error: error.message
    });
  }
};

// Get current user
const getMe = async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: {
          id: req.user._id,
          fullName: req.user.fullName,
          email: req.user.email,
          phoneNumber: req.user.phoneNumber,
          profilePicture: req.user.profilePicture,
          userType: req.user.userType,
          isActive: req.user.isActive,
          createdAt: req.user.createdAt
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user data',
      error: error.message
    });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const { fullName, email, phoneNumber } = req.body;
    const userId = req.user._id;

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if email is being changed and already exists
    if (email && email !== user.email) {
      const emailExists = await User.findOne({
        email,
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

    // Update fields only if provided
    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    if (phoneNumber) user.phoneNumber = phoneNumber;

    // Update location if provided
    const { latitude, longitude, address } = req.body;
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

    res.json({
      success: true,
      message: 'Profile updated successfully',
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
        }
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);

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
      message: 'Error updating profile',
      error: error.message
    });
  }
};

// Change password
const changePassword = async (req, res) => {
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

    // Validate new password strength (minimum 6 characters)
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

    // Check if user has a password (OAuth users might not have password)
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

    // Check if new password is same as current password
    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from current password'
      });
    }

    // Update password (will be hashed by pre-save hook in User model)
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

// Update user location
const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude, address } = req.body;
    const userId = req.user._id;

    // Validate coordinates
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid latitude or longitude'
      });
    }

    // Validate coordinate ranges
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({
        success: false,
        message: 'Coordinates out of valid range'
      });
    }

    // Find and update user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.location = {
      type: 'Point',
      coordinates: [lon, lat], // [longitude, latitude] - GeoJSON format
      address: address || user.location?.address || ''
    };

    await user.save();

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: {
        location: {
          latitude: lat,
          longitude: lon,
          address: user.location.address,
          coordinates: user.location.coordinates
        }
      }
    });
  } catch (error) {
    console.error('Location update error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating location',
      error: error.message
    });
  }
};

// Refresh access token
const refreshAccessToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const { verifyRefreshToken } = require('../utility/jwt');
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    // Hash the refresh token to compare with database
    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Find refresh token in database
    const storedToken = await RefreshToken.findOne({
      token: hashedToken,
      userId: decoded.id
    });

    if (!storedToken || !storedToken.isValid()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    // Find user
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User not found or inactive'
      });
    }

    // Generate new access token
    const accessToken = user.generateAccessToken();

    // Optional: Implement refresh token rotation
    // Generate new refresh token and revoke old one
    const newRefreshToken = user.generateRefreshToken();
    const refreshExpiresIn = getTokenExpiresIn('refresh');
    const expiresAt = new Date(Date.now() + refreshExpiresIn * 1000);

    // Revoke old refresh token
    storedToken.isRevoked = true;
    await storedToken.save();

    // Store new refresh token
    const newRefreshTokenDoc = new RefreshToken({
      userId: user._id,
      token: crypto.createHash('sha256').update(newRefreshToken).digest('hex'),
      expiresAt,
      deviceInfo: {
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress
      }
    });

    await newRefreshTokenDoc.save();

    // Update last used time
    storedToken.lastUsedAt = new Date();

    // Get access token expiration time
    const accessExpiresIn = getTokenExpiresIn('access');

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: accessExpiresIn,
        tokenType: 'Bearer'
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Error refreshing token',
      error: error.message
    });
  }
};

// Logout user
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Hash the refresh token
    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Find and revoke the refresh token
    const storedToken = await RefreshToken.findOne({
      token: hashedToken
    });

    if (storedToken) {
      storedToken.isRevoked = true;
      await storedToken.save();
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout',
      error: error.message
    });
  }
};

// Logout from all devices
const logoutAll = async (req, res) => {
  try {
    const userId = req.user._id;

    // Revoke all refresh tokens for this user
    await RefreshToken.revokeAllForUser(userId);

    res.json({
      success: true,
      message: 'Logged out from all devices successfully'
    });
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout',
      error: error.message
    });
  }
};

// Get user's bank information
const getBankInformation = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        bankInformation: user.bankInformation || null
      }
    });
  } catch (error) {
    console.error('Get bank information error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bank information',
      error: error.message
    });
  }
};

// Save user's bank information
const saveBankInformation = async (req, res) => {
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

    res.json({
      success: true,
      message: 'Bank information saved successfully',
      data: {
        bankInformation: user.bankInformation
      }
    });
  } catch (error) {
    console.error('Save bank information error:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving bank information',
      error: error.message
    });
  }
};

// Update user's bank information
const updateBankInformation = async (req, res) => {
  try {
    const {
      accountHolderName,
      bankName,
      accountNumber,
      routingNumber,
      accountHolderType
    } = req.body;

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

    res.json({
      success: true,
      message: 'Bank information updated successfully',
      data: {
        bankInformation: user.bankInformation
      }
    });
  } catch (error) {
    console.error('Update bank information error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating bank information',
      error: error.message
    });
  }
};

// Get user's recent providers (from bookings and appointments)
const getRecentProviders = async (req, res) => {
  try {
    const userId = req.user._id;
    const Booking = require('../models/Booking');
    const Appointment = require('../models/Appointment');
    const Provider = require('../models/Provider');
    const Service = require('../models/Service');

    // Get unique provider IDs from bookings (including pending)
    const bookingProviders = await Booking.distinct('providerId', {
      userId: userId,
      bookingStatus: { $in: ['pending', 'confirmed', 'in_progress', 'completed'] }
    });

    // Get unique provider IDs from appointments (including pending)
    const appointmentProviders = await Appointment.distinct('providerId', {
      userId: userId,
      appointmentStatus: { $in: ['pending', 'confirmed', 'in_progress', 'completed'] }
    });

    // Combine and get unique provider IDs
    const allProviderIds = [...new Set([...bookingProviders, ...appointmentProviders])];

    if (allProviderIds.length === 0) {
      return res.json({
        success: true,
        message: 'No recent providers found',
        data: {
          providers: [],
          count: 0
        }
      });
    }

    // Get provider details with user information
    const providers = await Provider.find({
      _id: { $in: allProviderIds },
      verificationStatus: 'verified'
    })
    .populate('userId', 'fullName email phoneNumber profilePicture location')
    .populate('categories', 'name icon')
    .select('userId categories rating totalReviews isAvailable completedJobs occupation activityTime createdAt')
    .sort({ updatedAt: -1 });

    // Get the most recent interaction date for each provider
    const providersWithLastService = await Promise.all(
      providers.map(async (provider) => {
        // Find most recent booking (including pending)
        const lastBooking = await Booking.findOne({
          userId: userId,
          providerId: provider._id,
          bookingStatus: { $in: ['pending', 'confirmed', 'in_progress', 'completed'] }
        })
        .sort({ createdAt: -1 })
        .select('bookingDate createdAt bookingStatus serviceId serviceSnapshot');

        // Find most recent appointment (including pending)
        const lastAppointment = await Appointment.findOne({
          userId: userId,
          providerId: provider._id,
          appointmentStatus: { $in: ['pending', 'confirmed', 'in_progress', 'completed'] }
        })
        .sort({ createdAt: -1 })
        .select('appointmentDate createdAt appointmentStatus serviceId serviceSnapshot selectedSlot');

        // Determine which is more recent
        let lastServiceDate = null;
        let lastServiceType = null;
        let lastServiceStatus = null;
        let lastServiceInfo = null;

        if (lastBooking && lastAppointment) {
          if (lastBooking.createdAt > lastAppointment.createdAt) {
            lastServiceDate = lastBooking.bookingDate;
            lastServiceType = 'booking';
            lastServiceStatus = lastBooking.bookingStatus;
            lastServiceInfo = {
              id: lastBooking.serviceId,
              name: lastBooking.serviceSnapshot?.serviceName || null,
              photo: lastBooking.serviceSnapshot?.servicePhoto || null,
              category: lastBooking.serviceSnapshot?.category || null,
              basePrice: lastBooking.serviceSnapshot?.basePrice ?? null
            };
          } else {
            lastServiceDate = lastAppointment.appointmentDate;
            lastServiceType = 'appointment';
            lastServiceStatus = lastAppointment.appointmentStatus;
            lastServiceInfo = {
              id: lastAppointment.serviceId,
              name: lastAppointment.serviceSnapshot?.serviceName || lastAppointment.serviceSnapshot?.headline || null,
              photo: lastAppointment.serviceSnapshot?.servicePhoto || null,
              category: lastAppointment.serviceSnapshot?.category || null,
              price: lastAppointment.selectedSlot?.price ?? null,
              duration: lastAppointment.selectedSlot?.duration ?? null,
              durationUnit: lastAppointment.selectedSlot?.durationUnit || null
            };
          }
        } else if (lastBooking) {
          lastServiceDate = lastBooking.bookingDate;
          lastServiceType = 'booking';
          lastServiceStatus = lastBooking.bookingStatus;
          lastServiceInfo = {
            id: lastBooking.serviceId,
            name: lastBooking.serviceSnapshot?.serviceName || null,
            photo: lastBooking.serviceSnapshot?.servicePhoto || null,
            category: lastBooking.serviceSnapshot?.category || null,
            basePrice: lastBooking.serviceSnapshot?.basePrice ?? null
          };
        } else if (lastAppointment) {
          lastServiceDate = lastAppointment.appointmentDate;
          lastServiceType = 'appointment';
          lastServiceStatus = lastAppointment.appointmentStatus;
          lastServiceInfo = {
            id: lastAppointment.serviceId,
            name: lastAppointment.serviceSnapshot?.serviceName || lastAppointment.serviceSnapshot?.headline || null,
            photo: lastAppointment.serviceSnapshot?.servicePhoto || null,
            category: lastAppointment.serviceSnapshot?.category || null,
            price: lastAppointment.selectedSlot?.price ?? null,
            duration: lastAppointment.selectedSlot?.duration ?? null,
            durationUnit: lastAppointment.selectedSlot?.durationUnit || null
          };
        }

        if (lastServiceInfo && !lastServiceInfo.description && lastServiceInfo.id) {
          const serviceDoc = await Service.findById(lastServiceInfo.id)
            .select('description headline servicePhoto category basePrice');
          if (serviceDoc) {
            lastServiceInfo.description = serviceDoc.description || null;
            if (!lastServiceInfo.name) {
              lastServiceInfo.name = serviceDoc.headline || null;
            }
            if (!lastServiceInfo.photo) {
              lastServiceInfo.photo = serviceDoc.servicePhoto || null;
            }
            if (!lastServiceInfo.category) {
              lastServiceInfo.category = serviceDoc.category || null;
            }
            if (lastServiceInfo.basePrice === null || lastServiceInfo.basePrice === undefined) {
              lastServiceInfo.basePrice = serviceDoc.basePrice ?? null;
            }
          }
        }

        return {
          id: provider._id,
          fullName: provider.userId?.fullName || 'Unknown',
          email: provider.userId?.email,
          phoneNumber: provider.userId?.phoneNumber,
          profilePicture: provider.userId?.profilePicture,
          location: provider.userId?.location ? {
            latitude: provider.userId.location.coordinates[1],
            longitude: provider.userId.location.coordinates[0],
            address: provider.userId.location.address
          } : null,
          categories: provider.categories || [],
          rating: provider.rating || 0,
          totalReviews: provider.totalReviews || 0,
          isAvailable: provider.isAvailable,
          completedJobs: provider.completedJobs || 0,
          occupation: provider.occupation || '',
          activityTime: provider.activityTime || '',
          lastService: {
            date: lastServiceDate,
            type: lastServiceType,
            status: lastServiceStatus,
            service: lastServiceInfo
          },
          joinedAt: provider.createdAt
        };
      })
    );

    // Sort by most recent service date
    providersWithLastService.sort((a, b) => {
      const dateA = a.lastService.date ? new Date(a.lastService.date) : new Date(0);
      const dateB = b.lastService.date ? new Date(b.lastService.date) : new Date(0);
      return dateB - dateA;
    });

    res.json({
      success: true,
      message: 'Recent providers fetched successfully',
      data: {
        providers: providersWithLastService,
        count: providersWithLastService.length
      }
    });
  } catch (error) {
    console.error('Get recent providers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching recent providers',
      error: error.message
    });
  }
};

module.exports = {
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
};
