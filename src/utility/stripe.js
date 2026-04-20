const Stripe = require('stripe');

let stripe = null;

const getStripe = () => {
  if (stripe) return stripe;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Stripe secret key not configured');
  }
  stripe = new Stripe(secretKey, {
    apiVersion: '2024-06-20'
  });
  return stripe;
};

module.exports = { getStripe };
