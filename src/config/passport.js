const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const AppleStrategy = require('passport-apple').Strategy;
const User = require('../models/User');
const Provider = require('../models/Provider');
const BusinessOwner = require('../models/BusinessOwner');

// Serialize user for the session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from the session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Helper function to create OAuth user with profile creation
const createOAuthUser = async (profile, authProvider, userType = 'user') => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    // Prepare user data
    const userData = {
      fullName: profile.displayName || profile.name?.firstName + ' ' + profile.name?.lastName || `${authProvider} User`,
      email: profile.emails?.[0]?.value || profile.email || null,
      authProvider: authProvider,
      providerId: profile.id,
      profilePicture: profile.photos?.[0]?.value || null,
      termsAccepted: true,
      userType: userType
    };

    // Create user
    const [user] = await User.create([userData], { session });

    // Create corresponding profile based on userType
    if (userType === 'provider') {
      await Provider.create([{
        userId: user._id,
        verificationStatus: 'pending'
      }], { session });
    } else if (userType === 'businessOwner') {
      await BusinessOwner.create([{
        userId: user._id
      }], { session });
    }

    await session.commitTransaction();
    return user;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Factory function to create OAuth callback handlers
const createOAuthHandler = (authProvider, userType = 'user') => {
  return async (accessToken, refreshToken, profile, done) => {
    try {
      // Check if user already exists with this provider ID and userType
      let user = await User.findOne({
        authProvider: authProvider,
        providerId: profile.id,
        userType: userType
      });

      if (user) {
        // User exists, return the user
        return done(null, user);
      }

      // Check if user exists with the same email and userType
      const email = profile.emails?.[0]?.value || profile.email;
      if (email) {
        const existingUser = await User.findOne({
          email: email,
          userType: userType
        });

        if (existingUser) {
          // User exists with same email and userType but different auth provider
          return done(null, false, {
            message: `A ${userType} account with this email already exists. Please sign in with your original method.`
          });
        }
      }

      // Create new user with profile
      user = await createOAuthUser(profile, authProvider, userType);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  };
};

// Google OAuth Strategy - Only initialize if credentials are provided
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  // Standard user Google strategy
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
        scope: ['profile', 'email']
      },
      createOAuthHandler('google', 'user')
    )
  );

  // Provider Google strategy
  passport.use('google-provider',
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_PROVIDER_CALLBACK_URL || '/api/auth/google/provider/callback',
        scope: ['profile', 'email']
      },
      createOAuthHandler('google', 'provider')
    )
  );

  // BusinessOwner Google strategy
  passport.use('google-business-owner',
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_BUSINESS_OWNER_CALLBACK_URL || '/api/auth/google/business-owner/callback',
        scope: ['profile', 'email']
      },
      createOAuthHandler('google', 'businessOwner')
    )
  );
} else {
  console.log('⚠️ Google OAuth not configured - skipping strategy initialization');
}

// Facebook OAuth Strategy - Only initialize if credentials are provided
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  // Standard user Facebook strategy
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_CALLBACK_URL || '/api/auth/facebook/callback',
        profileFields: ['id', 'displayName', 'email', 'picture.type(large)']
      },
      createOAuthHandler('facebook', 'user')
    )
  );

  // Provider Facebook strategy
  passport.use('facebook-provider',
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_PROVIDER_CALLBACK_URL || '/api/auth/facebook/provider/callback',
        profileFields: ['id', 'displayName', 'email', 'picture.type(large)']
      },
      createOAuthHandler('facebook', 'provider')
    )
  );

  // BusinessOwner Facebook strategy
  passport.use('facebook-business-owner',
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_BUSINESS_OWNER_CALLBACK_URL || '/api/auth/facebook/business-owner/callback',
        profileFields: ['id', 'displayName', 'email', 'picture.type(large)']
      },
      createOAuthHandler('facebook', 'businessOwner')
    )
  );
} else {
  console.log('⚠️ Facebook OAuth not configured - skipping strategy initialization');
}

// Factory function for Apple OAuth (different callback signature)
const createAppleOAuthHandler = (authProvider, userType = 'user') => {
  return async (accessToken, refreshToken, idToken, profile, done) => {
    try {
      // Check if user already exists with this provider ID and userType
      let user = await User.findOne({
        authProvider: authProvider,
        providerId: profile.id,
        userType: userType
      });

      if (user) {
        // User exists, return the user
        return done(null, user);
      }

      // Check if user exists with the same email and userType
      if (profile.email) {
        const existingUser = await User.findOne({
          email: profile.email,
          userType: userType
        });

        if (existingUser) {
          // User exists with same email and userType but different auth provider
          return done(null, false, {
            message: `A ${userType} account with this email already exists. Please sign in with your original method.`
          });
        }
      }

      // Create new user with profile
      user = await createOAuthUser(profile, authProvider, userType);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  };
};

// Apple OAuth Strategy - Only initialize if credentials are provided
if (process.env.APPLE_SERVICE_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY) {
  // Standard user Apple strategy
  passport.use(
    new AppleStrategy(
      {
        clientID: process.env.APPLE_SERVICE_ID,
        teamID: process.env.APPLE_TEAM_ID,
        callbackURL: process.env.APPLE_CALLBACK_URL || '/api/auth/apple/callback',
        keyID: process.env.APPLE_KEY_ID,
        privateKeyString: process.env.APPLE_PRIVATE_KEY,
        scope: ['name', 'email']
      },
      createAppleOAuthHandler('apple', 'user')
    )
  );

  // Provider Apple strategy
  passport.use('apple-provider',
    new AppleStrategy(
      {
        clientID: process.env.APPLE_SERVICE_ID,
        teamID: process.env.APPLE_TEAM_ID,
        callbackURL: process.env.APPLE_PROVIDER_CALLBACK_URL || '/api/auth/apple/provider/callback',
        keyID: process.env.APPLE_KEY_ID,
        privateKeyString: process.env.APPLE_PRIVATE_KEY,
        scope: ['name', 'email']
      },
      createAppleOAuthHandler('apple', 'provider')
    )
  );

  // BusinessOwner Apple strategy
  passport.use('apple-business-owner',
    new AppleStrategy(
      {
        clientID: process.env.APPLE_SERVICE_ID,
        teamID: process.env.APPLE_TEAM_ID,
        callbackURL: process.env.APPLE_BUSINESS_OWNER_CALLBACK_URL || '/api/auth/apple/business-owner/callback',
        keyID: process.env.APPLE_KEY_ID,
        privateKeyString: process.env.APPLE_PRIVATE_KEY,
        scope: ['name', 'email']
      },
      createAppleOAuthHandler('apple', 'businessOwner')
    )
  );
} else {
  console.log('⚠️ Apple OAuth not configured - skipping strategy initialization');
}

module.exports = passport;
