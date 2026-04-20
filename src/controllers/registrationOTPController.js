const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const RegistrationOTP = require('../models/RegistrationOTP');
const { getTokenExpiresIn } = require('../utility/jwt');
const { sendRegistrationOTPEmail } = require('../utility/emailService');
const { sendRegistrationOTPSMS } = require('../utility/smsService');

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const VERIFICATION_TOKEN_EXPIRY_MS = 30 * 60 * 1000;

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
const hashValue = (value) => crypto.createHash('sha256').update(value).digest('hex');

const createUserAndTokens = async (req, userPayload) => {
  const user = new User({
    fullName: userPayload.fullName,
    email: userPayload.email || undefined,
    phoneNumber: userPayload.phoneNumber || undefined,
    password: userPayload.password,
    termsAccepted: userPayload.termsAccepted,
    userType: 'user',
    isPendingVerification: false
  });

  await user.save();

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
    accessToken,
    refreshToken,
    accessExpiresIn
  };
};

// Request registration OTP
const requestRegistrationOTP = async (req, res) => {
  try {
    const { email, phoneNumber, fullName, password, termsAccepted } = req.body;

    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone number is required'
      });
    }

    if (password && password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const identifiers = [];
    if (email) identifiers.push({ email });
    if (phoneNumber) identifiers.push({ phoneNumber });

    const existingUser = await User.findOne({ $or: identifiers });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email or phone number'
      });
    }

    const pendingQuery = identifiers.length > 1 ? { $or: identifiers } : identifiers[0];
    const existingPending = await RegistrationOTP.findOne(pendingQuery);
    if (existingPending) {
      if (email && existingPending.email && email.toLowerCase() !== existingPending.email) {
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

    let passwordHash;
    if (password) {
      const salt = await bcrypt.genSalt(12);
      passwordHash = await bcrypt.hash(password, salt);
    }

    const otp = generateOTP();
    const otpHash = hashValue(otp);
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    const update = {
      email: email || existingPending?.email || undefined,
      phoneNumber: phoneNumber || existingPending?.phoneNumber || undefined,
      otpHash,
      otpExpiresAt,
      isVerified: false,
      verificationTokenHash: undefined,
      verificationTokenExpiresAt: undefined
    };

    if (fullName) {
      update.fullName = fullName;
    }

    if (typeof termsAccepted === 'boolean') {
      update.termsAccepted = termsAccepted;
    }

    if (passwordHash) {
      update.passwordHash = passwordHash;
    }

    const pending = await RegistrationOTP.findOneAndUpdate(
      pendingQuery,
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      const displayName = fullName || existingPending?.fullName || 'there';
      if (email) {
        await sendRegistrationOTPEmail(email, otp, displayName);
      } else {
        await sendRegistrationOTPSMS(phoneNumber, otp, displayName);
      }
    } catch (sendError) {
      await RegistrationOTP.deleteOne({ _id: pending._id });
      console.error('Error sending registration OTP:', sendError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again later.',
        error: process.env.NODE_ENV === 'development' ? sendError.message : undefined
      });
    }

    return res.status(200).json({
      success: true,
      message: `OTP has been sent to your ${email ? 'email' : 'phone number'}.`,
      data: {
        sentTo: email ? 'email' : 'phone',
        expiresIn: '10 minutes'
      }
    });
  } catch (error) {
    console.error('Error in requestRegistrationOTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing registration OTP request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verify registration OTP
const verifyRegistrationOTP = async (req, res) => {
  try {
    const { email, phoneNumber, otp, fullName, password, termsAccepted } = req.body;

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

    if (password && password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const pending = await RegistrationOTP.findOne(email ? { email } : { phoneNumber })
      .select('+otpHash +otpExpiresAt +verificationTokenHash +verificationTokenExpiresAt +passwordHash');

    if (!pending) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    if (pending.otpExpiresAt && Date.now() > pending.otpExpiresAt.getTime()) {
      await RegistrationOTP.deleteOne({ _id: pending._id });
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

    const resolvedFullName = pending.fullName || fullName;
    const resolvedTermsAccepted = typeof termsAccepted === 'boolean' ? termsAccepted : pending.termsAccepted;
    const resolvedPassword = pending.passwordHash || password;
    const canComplete = resolvedFullName && resolvedPassword && resolvedTermsAccepted === true;

    if (canComplete) {
      const identifiers = [];
      if (pending.email) identifiers.push({ email: pending.email });
      if (pending.phoneNumber) identifiers.push({ phoneNumber: pending.phoneNumber });

      const existingUser = await User.findOne({ $or: identifiers });
      if (existingUser) {
        await RegistrationOTP.deleteOne({ _id: pending._id });
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email or phone number'
        });
      }

      const authData = await createUserAndTokens(req, {
        fullName: resolvedFullName,
        email: pending.email || undefined,
        phoneNumber: pending.phoneNumber || undefined,
        password: resolvedPassword,
        termsAccepted: resolvedTermsAccepted
      });

      await RegistrationOTP.deleteOne({ _id: pending._id });

      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: authData.user._id,
            fullName: authData.user.fullName,
            email: authData.user.email,
            phoneNumber: authData.user.phoneNumber,
            userType: authData.user.userType
          },
          accessToken: authData.accessToken,
          refreshToken: authData.refreshToken,
          expiresIn: authData.accessExpiresIn,
          tokenType: 'Bearer'
        }
      });
    }

    if (fullName && !pending.fullName) {
      pending.fullName = fullName;
    }

    if (typeof termsAccepted === 'boolean') {
      pending.termsAccepted = termsAccepted;
    }

    if (password && !pending.passwordHash) {
      const salt = await bcrypt.genSalt(12);
      pending.passwordHash = await bcrypt.hash(password, salt);
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    pending.isVerified = true;
    pending.verificationTokenHash = hashValue(verificationToken);
    pending.verificationTokenExpiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS);
    await pending.save();

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully.',
      data: {
        verificationToken,
        identifier: email || phoneNumber,
        expiresIn: '30 minutes'
      }
    });
  } catch (error) {
    console.error('Error in verifyRegistrationOTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Complete registration after OTP verification
const completeRegistration = async (req, res) => {
  try {
    const { verificationToken, fullName, password, termsAccepted, email, phoneNumber } = req.body;

    if (!verificationToken) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    if (password && password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const tokenHash = hashValue(verificationToken);
    const pending = await RegistrationOTP.findOne({
      verificationTokenHash: tokenHash,
      isVerified: true,
      verificationTokenExpiresAt: { $gt: new Date() }
    }).select('+passwordHash');

    if (!pending) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    if (email && !pending.email) {
      return res.status(400).json({
        success: false,
        message: 'Email does not match the verified identifier'
      });
    }

    if (email && pending.email && email.toLowerCase() !== pending.email) {
      return res.status(400).json({
        success: false,
        message: 'Email does not match the verified identifier'
      });
    }

    if (phoneNumber && !pending.phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number does not match the verified identifier'
      });
    }

    if (phoneNumber && pending.phoneNumber && phoneNumber !== pending.phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number does not match the verified identifier'
      });
    }

    const query = [];
    if (pending.email) query.push({ email: pending.email });
    if (pending.phoneNumber) query.push({ phoneNumber: pending.phoneNumber });

    const existingUser = await User.findOne({ $or: query });
    if (existingUser) {
      await RegistrationOTP.deleteOne({ _id: pending._id });
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email or phone number'
      });
    }

    const resolvedFullName = fullName || pending.fullName;
    const resolvedTermsAccepted = typeof termsAccepted === 'boolean' ? termsAccepted : pending.termsAccepted;
    const resolvedPassword = password || pending.passwordHash;

    if (!resolvedFullName || !resolvedPassword) {
      return res.status(400).json({
        success: false,
        message: 'Full name and password are required'
      });
    }

    if (!resolvedTermsAccepted || resolvedTermsAccepted !== true) {
      return res.status(400).json({
        success: false,
        message: 'You must accept the terms and conditions'
      });
    }

    const authData = await createUserAndTokens(req, {
      fullName: resolvedFullName,
      email: pending.email || undefined,
      phoneNumber: pending.phoneNumber || undefined,
      password: resolvedPassword,
      termsAccepted: resolvedTermsAccepted
    });

    await RegistrationOTP.deleteOne({ _id: pending._id });

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: authData.user._id,
          fullName: authData.user.fullName,
          email: authData.user.email,
          phoneNumber: authData.user.phoneNumber,
          userType: authData.user.userType
        },
        accessToken: authData.accessToken,
        refreshToken: authData.refreshToken,
        expiresIn: authData.accessExpiresIn,
        tokenType: 'Bearer'
      }
    });
  } catch (error) {
    console.error('Error in completeRegistration:', error);
    return res.status(500).json({
      success: false,
      message: 'Error completing registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  requestRegistrationOTP,
  verifyRegistrationOTP,
  completeRegistration
};
