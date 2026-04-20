/**
 * @desc    Get payment client configuration
 * @route   GET /api/payments/config
 * @access  Public
 */
exports.getPaymentConfig = async (req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  const configuredMode = (process.env.STRIPE_MODE || '').toLowerCase();
  const keyLooksLive = publishableKey ? publishableKey.startsWith('pk_live_') : false;
  const isTestMode = configuredMode
    ? configuredMode !== 'live'
    : !keyLooksLive;

  if (!publishableKey) {
    return res.status(503).json({
      success: false,
      message: 'Stripe publishable key is not configured'
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      provider: 'stripe',
      publishableKey,
      merchantCountryCode: (process.env.STRIPE_MERCHANT_COUNTRY_CODE || 'US').toUpperCase(),
      currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
      isTestMode
    }
  });
};
