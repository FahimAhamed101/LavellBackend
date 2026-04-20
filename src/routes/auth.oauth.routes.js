const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const jwt = require('jsonwebtoken');
const Provider = require('../models/Provider');
const BusinessOwner = require('../models/BusinessOwner');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { getTokenExpiresIn } = require('../utility/jwt');
const { upsertDeviceToken } = require('../utility/deviceToken');
const crypto = require('crypto');
const axios = require('axios');

// Helper function to generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      userType: user.userType,
      authProvider: user.authProvider
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Helper function to send response with token (standard user)
const sendTokenResponse = (res, user) => {
  const token = generateToken(user);

  res.json({
    success: true,
    message: 'Authentication successful',
    token,
    user: {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      profilePicture: user.profilePicture,
      userType: user.userType,
      authProvider: user.authProvider
    }
  });
};

// Helper function to send response with token for Provider
const sendProviderTokenResponse = async (res, user) => {
  try {
    const provider = await Provider.findOne({ userId: user._id });
    const token = generateToken(user);

    res.json({
      success: true,
      message: 'Provider authentication successful',
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        profilePicture: user.profilePicture,
        userType: user.userType,
        authProvider: user.authProvider
      },
      provider: {
        id: provider._id,
        verificationStatus: provider.verificationStatus,
        categories: provider.categories,
        rating: provider.rating,
        isAvailable: provider.isAvailable
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching provider profile',
      error: error.message
    });
  }
};

// Helper function to send response with token for BusinessOwner
const sendBusinessOwnerTokenResponse = async (res, user) => {
  try {
    const businessOwner = await BusinessOwner.findOne({ userId: user._id });
    const token = generateToken(user);

    res.json({
      success: true,
      message: 'Business Owner authentication successful',
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        profilePicture: user.profilePicture,
        userType: user.userType,
        authProvider: user.authProvider
      },
      businessOwner: {
        id: businessOwner._id,
        occupation: businessOwner.occupation,
        referenceId: businessOwner.referenceId
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching business owner profile',
      error: error.message
    });
  }
};

const normalizeProvider = (provider) => {
  const raw = (provider || '').toString().trim().toLowerCase();
  if (raw === 'google') return 'google';
  if (raw === 'facebook') return 'facebook';
  if (raw === 'apple') return 'apple';
  return null;
};

const decodeJwtPart = (token, index) => {
  const parts = token.split('.');
  if (parts.length <= index) return null;
  const normalized = parts[index].replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
};

const verifyGoogleToken = async ({ idToken, accessToken }) => {
  if (idToken) {
    try {
      const { data } = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
        params: { id_token: idToken },
        timeout: 10000
      });

      if (!data?.sub) throw new Error('Invalid Google ID token payload');
      if (process.env.GOOGLE_CLIENT_ID && data.aud !== process.env.GOOGLE_CLIENT_ID) {
        throw new Error('Google token audience mismatch');
      }

      return {
        id: data.sub,
        email: data.email || null,
        fullName: data.name || [data.given_name, data.family_name].filter(Boolean).join(' ').trim(),
        picture: data.picture || null,
        emailVerified: data.email_verified === 'true' || data.email_verified === true
      };
    } catch (error) {
      // Fallback to access-token verification below
    }
  }

  if (!accessToken) {
    throw new Error('Google access token is required');
  }

  const { data } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000
  });

  if (!data?.sub) {
    throw new Error('Invalid Google access token');
  }

  return {
    id: data.sub,
    email: data.email || null,
    fullName: data.name || [data.given_name, data.family_name].filter(Boolean).join(' ').trim(),
    picture: data.picture || null,
    emailVerified: !!data.email_verified
  };
};

const verifyFacebookToken = async ({ accessToken }) => {
  if (!accessToken) {
    throw new Error('Facebook access token is required');
  }

  const { data } = await axios.get('https://graph.facebook.com/v18.0/me', {
    params: {
      fields: 'id,name,email,first_name,last_name,picture.type(large)',
      access_token: accessToken
    },
    timeout: 10000
  });

  if (!data?.id) {
    throw new Error('Invalid Facebook access token');
  }

  return {
    id: data.id,
    email: data.email || null,
    fullName: data.name || [data.first_name, data.last_name].filter(Boolean).join(' ').trim(),
    picture: data.picture?.data?.url || null,
    emailVerified: !!data.email
  };
};

const verifyAppleIdentityToken = async ({ idToken }) => {
  if (!idToken) {
    throw new Error('Apple identity token is required');
  }
  if (!process.env.APPLE_SERVICE_ID || process.env.APPLE_SERVICE_ID.startsWith('your_apple_')) {
    throw new Error('Apple Sign-In is not configured on server');
  }

  const header = decodeJwtPart(idToken, 0);
  if (!header?.kid) {
    throw new Error('Invalid Apple token header');
  }

  const { data } = await axios.get('https://appleid.apple.com/auth/keys', {
    timeout: 10000
  });
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    throw new Error('Apple public key not found');
  }

  const { createPublicKey } = require('crypto');
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const payload = jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    issuer: 'https://appleid.apple.com',
    audience: process.env.APPLE_SERVICE_ID
  });

  if (!payload?.sub) {
    throw new Error('Invalid Apple token payload');
  }

  return {
    id: payload.sub,
    email: payload.email || null,
    fullName: null,
    picture: null,
    emailVerified: payload.email_verified === 'true' || payload.email_verified === true
  };
};

const verifySocialToken = async (provider, tokens) => {
  if (provider === 'google') return verifyGoogleToken(tokens);
  if (provider === 'facebook') return verifyFacebookToken(tokens);
  if (provider === 'apple') return verifyAppleIdentityToken(tokens);
  throw new Error('Unsupported provider');
};

const buildDefaultName = (email, provider) => {
  if (email && email.includes('@')) {
    return email.split('@')[0];
  }
  return `${provider} user`;
};

const upsertSocialUser = async ({ profile, provider, fullNameFromClient }) => {
  const providerQuery = {
    authProvider: provider,
    providerId: profile.id,
    userType: 'user'
  };

  let user = await User.findOne(providerQuery);
  if (!user && profile.email) {
    const emailUser = await User.findOne({ email: profile.email, userType: 'user' });
    if (emailUser && emailUser.authProvider !== provider) {
      throw new Error(`An account already exists with this email via ${emailUser.authProvider}`);
    }
    user = emailUser;
  }

  const resolvedName =
    (fullNameFromClient || '').trim() ||
    (profile.fullName || '').trim() ||
    buildDefaultName(profile.email, provider);

  if (!user) {
    if (!profile.email) {
      throw new Error('Email is required for first-time social sign-in');
    }

    user = await User.create({
      fullName: resolvedName,
      email: profile.email,
      authProvider: provider,
      providerId: profile.id,
      profilePicture: profile.picture || null,
      termsAccepted: true,
      userType: 'user'
    });
  } else {
    user.authProvider = provider;
    user.providerId = profile.id;
    if (!user.profilePicture && profile.picture) {
      user.profilePicture = profile.picture;
    }
    if ((!user.fullName || user.fullName.trim().length < 2) && resolvedName) {
      user.fullName = resolvedName;
    }
    if (!user.email && profile.email) {
      user.email = profile.email;
    }
    await user.save();
  }

  return user;
};

const issueLoginTokens = async (user, req, { fcmToken, platform }) => {
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

  if (fcmToken) {
    try {
      await upsertDeviceToken({
        userId: user._id,
        token: fcmToken,
        platform: platform || 'unknown'
      });
    } catch (tokenError) {
      console.error('Register device token on social login error:', tokenError);
    }
  }

  return {
    user: {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      profilePicture: user.profilePicture,
      userType: user.userType
    },
    accessToken,
    refreshToken,
    expiresIn: getTokenExpiresIn('access'),
    tokenType: 'Bearer'
  };
};

const handleDirectSocialLogin = async (req, res) => {
  try {
    const {
      provider: rawProvider,
      accessToken,
      idToken,
      fullName,
      fcmToken,
      platform
    } = req.body || {};

    const provider = normalizeProvider(rawProvider);
    if (!provider) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported provider'
      });
    }

    if (provider === 'google' && !idToken && !accessToken) {
      return res.status(400).json({
        success: false,
        message: 'Google idToken or accessToken is required'
      });
    }
    if (provider === 'facebook' && !accessToken) {
      return res.status(400).json({
        success: false,
        message: 'Facebook accessToken is required'
      });
    }
    if (provider === 'apple' && !idToken) {
      return res.status(400).json({
        success: false,
        message: 'Apple idToken is required'
      });
    }

    const profile = await verifySocialToken(provider, { accessToken, idToken });
    const user = await upsertSocialUser({
      profile,
      provider,
      fullNameFromClient: fullName
    });
    const loginData = await issueLoginTokens(user, req, { fcmToken, platform });

    return res.status(200).json({
      success: true,
      message: 'Social login successful',
      data: loginData
    });
  } catch (error) {
    console.error('Direct social login error:', error);
    return res.status(401).json({
      success: false,
      message: error.message || 'Social authentication failed'
    });
  }
};

// Mobile-friendly direct social login (token-in, app token-out)
router.post('/social/direct-login', handleDirectSocialLogin);
// Backward-compatible alias
router.post('/direct-login', handleDirectSocialLogin);

// ============================================
// GOOGLE OAUTH ROUTES
// ============================================

// @route   GET /api/auth/google
// @desc    Initiate Google OAuth
// @access  Public
router.get('/google',
  passport.authenticate('google', {
    session: false,
    scope: ['profile', 'email']
  })
);

// @route   GET /api/auth/google/callback
// @desc    Google OAuth callback
// @access  Public
router.get('/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: '/login?error=google_auth_failed'
  }),
  (req, res) => {
    // Successful authentication
    if (req.user) {
      sendTokenResponse(res, req.user);
    } else {
      res.status(401).json({
        success: false,
        message: 'Google authentication failed'
      });
    }
  }
);

// ============================================
// FACEBOOK OAUTH ROUTES
// ============================================

// @route   GET /api/auth/facebook
// @desc    Initiate Facebook OAuth
// @access  Public
router.get('/facebook',
  passport.authenticate('facebook', {
    session: false,
    scope: ['email', 'public_profile']
  })
);

// @route   GET /api/auth/facebook/callback
// @desc    Facebook OAuth callback
// @access  Public
router.get('/facebook/callback',
  passport.authenticate('facebook', {
    session: false,
    failureRedirect: '/login?error=facebook_auth_failed'
  }),
  (req, res) => {
    // Successful authentication
    if (req.user) {
      sendTokenResponse(res, req.user);
    } else {
      res.status(401).json({
        success: false,
        message: 'Facebook authentication failed'
      });
    }
  }
);

// ============================================
// APPLE OAUTH ROUTES
// ============================================

// @route   POST /api/auth/apple
// @desc    Initiate Apple OAuth
// @access  Public
router.post('/apple',
  passport.authenticate('apple', {
    session: false,
    scope: ['name', 'email']
  })
);

// @route   POST /api/auth/apple/callback
// @desc    Apple OAuth callback
// @access  Public
router.post('/apple/callback',
  passport.authenticate('apple', {
    session: false,
    failureRedirect: '/login?error=apple_auth_failed'
  }),
  (req, res) => {
    // Successful authentication
    if (req.user) {
      sendTokenResponse(res, req.user);
    } else {
      res.status(401).json({
        success: false,
        message: 'Apple authentication failed'
      });
    }
  }
);

// ============================================
// LOGOUT ROUTE
// ============================================

// @route   POST /api/auth/logout
// @desc    Logout user (client should delete token)
// @access  Public
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully. Please delete your token on the client side.'
  });
});

// ============================================
// CHECK AUTH STATUS
// ============================================

// @route   GET /api/auth/me
// @desc    Get current user info
// @access  Private
const protect = require('../middleware/auth');

router.get('/me', protect, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      fullName: req.user.fullName,
      email: req.user.email,
      phoneNumber: req.user.phoneNumber,
      profilePicture: req.user.profilePicture,
      userType: req.user.userType,
      authProvider: req.user.authProvider,
      createdAt: req.user.createdAt
    }
  });
});

// ============================================
// PROVIDER OAUTH ROUTES
// ============================================

// @route   GET /api/auth/google/provider
// @desc    Initiate Google OAuth for Provider
// @access  Public
router.get('/google/provider',
  passport.authenticate('google-provider', {
    session: false,
    scope: ['profile', 'email']
  })
);

// @route   GET /api/auth/google/provider/callback
// @desc    Google OAuth callback for Provider
// @access  Public
router.get('/google/provider/callback',
  passport.authenticate('google-provider', {
    session: false,
    failureRedirect: '/login?error=google_provider_auth_failed'
  }),
  async (req, res) => {
    if (req.user) {
      await sendProviderTokenResponse(res, req.user);
    } else {
      res.status(401).json({
        success: false,
        message: 'Google Provider authentication failed'
      });
    }
  }
);

// @route   GET /api/auth/facebook/provider
// @desc    Initiate Facebook OAuth for Provider
// @access  Public
router.get('/facebook/provider',
  passport.authenticate('facebook-provider', {
    session: false,
    scope: ['email', 'public_profile']
  })
);

// @route   GET /api/auth/facebook/provider/callback
// @desc    Facebook OAuth callback for Provider
// @access  Public
router.get('/facebook/provider/callback',
  passport.authenticate('facebook-provider', {
    session: false,
    failureRedirect: '/login?error=facebook_provider_auth_failed'
  }),
  async (req, res) => {
    if (req.user) {
      await sendProviderTokenResponse(res, req.user);
    } else {
      res.status(401).json({
        success: false,
        message: 'Facebook Provider authentication failed'
      });
    }
  }
);

// @route   POST /api/auth/apple/provider
// @desc    Initiate Apple OAuth for Provider
// @access  Public
router.post('/apple/provider',
  passport.authenticate('apple-provider', {
    session: false,
    scope: ['name', 'email']
  })
);

// @route   POST /api/auth/apple/provider/callback
// @desc    Apple OAuth callback for Provider
// @access  Public
router.post('/apple/provider/callback',
  passport.authenticate('apple-provider', {
    session: false,
    failureRedirect: '/login?error=apple_provider_auth_failed'
  }),
  async (req, res) => {
    if (req.user) {
      await sendProviderTokenResponse(res, req.user);
    } else {
      res.status(401).json({
        success: false,
        message: 'Apple Provider authentication failed'
      });
    }
  }
);

// ============================================
// BUSINESS OWNER OAUTH ROUTES
// ============================================

// @route   GET /api/auth/google/business-owner
// @desc    Initiate Google OAuth for Business Owner
// @access  Public
router.get('/google/business-owner',
  passport.authenticate('google-business-owner', {
    session: false,
    scope: ['profile', 'email']
  })
);

// @route   GET /api/auth/google/business-owner/callback
// @desc    Google OAuth callback for Business Owner
// @access  Public
router.get('/google/business-owner/callback',
  passport.authenticate('google-business-owner', {
    session: false,
    failureRedirect: '/login?error=google_business_owner_auth_failed'
  }),
  async (req, res) => {
    if (req.user) {
      await sendBusinessOwnerTokenResponse(res, req.user);
    } else {
      res.status(401).json({
        success: false,
        message: 'Google Business Owner authentication failed'
      });
    }
  }
);

// @route   GET /api/auth/facebook/business-owner
// @desc    Initiate Facebook OAuth for Business Owner
// @access  Public
router.get('/facebook/business-owner',
  passport.authenticate('facebook-business-owner', {
    session: false,
    scope: ['email', 'public_profile']
  })
);

// @route   GET /api/auth/facebook/business-owner/callback
// @desc    Facebook OAuth callback for Business Owner
// @access  Public
router.get('/facebook/business-owner/callback',
  passport.authenticate('facebook-business-owner', {
    session: false,
    failureRedirect: '/login?error=facebook_business_owner_auth_failed'
  }),
  async (req, res) => {
    if (req.user) {
      await sendBusinessOwnerTokenResponse(res, req.user);
    } else {
      res.status(401).json({
        success: false,
        message: 'Facebook Business Owner authentication failed'
      });
    }
  }
);

// @route   POST /api/auth/apple/business-owner
// @desc    Initiate Apple OAuth for Business Owner
// @access  Public
router.post('/apple/business-owner',
  passport.authenticate('apple-business-owner', {
    session: false,
    scope: ['name', 'email']
  })
);

// @route   POST /api/auth/apple/business-owner/callback
// @desc    Apple OAuth callback for Business Owner
// @access  Public
router.post('/apple/business-owner/callback',
  passport.authenticate('apple-business-owner', {
    session: false,
    failureRedirect: '/login?error=apple_business_owner_auth_failed'
  }),
  async (req, res) => {
    if (req.user) {
      await sendBusinessOwnerTokenResponse(res, req.user);
    } else {
      res.status(401).json({
        success: false,
        message: 'Apple Business Owner authentication failed'
      });
    }
  }
);

module.exports = router;
