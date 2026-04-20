require('dotenv').config({ path: '.env' });
console.log('✅ Environment variables loaded');
console.log('📍 GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'Found' : 'Not found');
console.log('📍 CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME ? 'Found' : 'Not found');
require('./src/config/firebase');

const express = require('express');
const http = require('http');
const cors = require('cors');
const session = require('express-session');
const passport = require('./src/config/passport');
const connectDB = require('./src/config/database');
const { handleStripeWebhook } = require('./src/controllers/stripeWebhookController');

// Connect to database
connectDB();

const app = express();
const httpServer = http.createServer(app);

// Stripe webhook (must be before body parsers)
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware (required for Passport)
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Basic route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Lavellh Server is running!',
    timestamp: new Date().toISOString()
  });
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API is working!'
  });
});

// Debug route to test body parsing
app.post('/api/debug', (req, res) => {
  res.json({
    success: true,
    message: 'Body parser is working',
    bodyReceived: req.body,
    contentType: req.get('Content-Type')
  });
});

// Import routes
const routes = require('./src/routes');

// Use routes
app.use('/api', routes);

// 404 handler - FIXED for Express 5
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

const PORT = process.env.PORT || 5000;
const setupSocket = require('./src/socket');
setupSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🚀 Express version: ${require('express/package.json').version}`);
});
