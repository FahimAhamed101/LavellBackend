const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const categoryController = require('../controllers/categoryController');
const faqController = require('../controllers/faqController');
const { verifyAdminToken, requirePermission, requireSuperAdmin } = require('../middleware/adminAuth');
const { uploadCategoryIcon, handleUploadError } = require('../middleware/upload');

/**
 * @route   POST /api/admin/login
 * @desc    Admin login
 * @access  Public
 */
router.post('/login', adminController.loginAdmin);
/**
 * @route   POST /api/admin/refresh-token
 * @desc    Refresh admin access token
 * @access  Public
 */
router.post('/refresh-token', adminController.refreshAdminToken);

/**
 * @route   GET /api/admin/me
 * @desc    Get admin profile
 * @access  Private (Admin)
 */
router.get('/me', verifyAdminToken, adminController.getAdminProfile);

/**
 * @route   GET /api/admin/dashboard/stats
 * @desc    Get dashboard statistics
 * @access  Private (Admin)
 */
router.get('/dashboard/stats', verifyAdminToken, adminController.getDashboardStats);

/**
 * @route   GET /api/admin/transactions
 * @desc    Get all transactions (admin)
 * @access  Private (Admin with canViewReports permission)
 */
router.get(
  '/transactions',
  verifyAdminToken,
  requirePermission('canViewReports'),
  adminController.getTransactions
);

/**
 * @route   POST /api/admin/transactions/refund
 * @desc    Refund a transaction by Stripe paymentIntentId (full or partial)
 * @access  Private (Admin with canViewReports permission)
 */
router.post(
  '/transactions/refund',
  verifyAdminToken,
  requirePermission('canViewReports'),
  adminController.refundTransaction
);

/**
 * @route   GET /api/admin/transactions/refunds
 * @desc    Get refund audit logs
 * @access  Private (Admin with canViewReports permission)
 */
router.get(
  '/transactions/refunds',
  verifyAdminToken,
  requirePermission('canViewReports'),
  adminController.getRefundLogs
);

// ============ PROVIDER MANAGEMENT ============

/**
 * @route   GET /api/admin/providers
 * @desc    Get all providers with filters
 * @access  Private (Admin with canManageProviders permission)
 */
router.get(
  '/providers',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.getAllProviders
);

/**
 * @route   GET /api/admin/providers/:id
 * @desc    Get provider details
 * @access  Private (Admin with canManageProviders permission)
 */
router.get(
  '/providers/:id',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.getProviderDetails
);

/**
 * @route   PUT /api/admin/providers/:id/approve
 * @desc    Approve provider
 * @access  Private (Admin with canManageProviders permission)
 */
router.put(
  '/providers/:id/approve',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.approveProvider
);

/**
 * @route   PUT /api/admin/providers/:id/reject
 * @desc    Reject provider with reason
 * @access  Private (Admin with canManageProviders permission)
 */
router.put(
  '/providers/:id/reject',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.rejectProvider
);

/**
 * @route   PUT /api/admin/providers/:id/toggle-status
 * @desc    Block/Unblock provider
 * @access  Private (Admin with canManageProviders permission)
 */
router.put(
  '/providers/:id/toggle-status',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.toggleProviderStatus
);

/**
 * @route   DELETE /api/admin/providers/:id
 * @desc    Delete provider account permanently
 * @access  Private (Admin with canManageProviders permission)
 */
router.delete(
  '/providers/:id',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.deleteProvider
);

/**
 * @route   GET /api/admin/reviews/providers
 * @desc    Get provider reviews for moderation
 * @access  Private (Admin with canManageProviders permission)
 */
router.get(
  '/reviews/providers',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.getProviderReviews
);

/**
 * @route   PATCH /api/admin/reviews/providers/:id/hide
 * @desc    Hide provider review
 * @access  Private (Admin with canManageProviders permission)
 */
router.patch(
  '/reviews/providers/:id/hide',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.hideProviderReview
);

/**
 * @route   PATCH /api/admin/reviews/providers/:id/restore
 * @desc    Restore provider review
 * @access  Private (Admin with canManageProviders permission)
 */
router.patch(
  '/reviews/providers/:id/restore',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.restoreProviderReview
);

/**
 * @route   GET /api/admin/discovery/providers/ranking
 * @desc    Get provider discovery ranking (pinned providers in order)
 * @access  Private (Admin with canManageProviders permission)
 */
router.get(
  '/discovery/providers/ranking',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.getProviderDiscoveryRanking
);

/**
 * @route   PUT /api/admin/discovery/providers/ranking
 * @desc    Bulk update provider discovery ranking
 * @access  Private (Admin with canManageProviders permission)
 */
router.put(
  '/discovery/providers/ranking',
  verifyAdminToken,
  requirePermission('canManageProviders'),
  adminController.updateProviderDiscoveryRanking
);

// ============ USER MANAGEMENT ============

/**
 * @route   GET /api/admin/users
 * @desc    Get all users with search and pagination
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/users',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getAllUsers
);

/**
 * @route   GET /api/admin/users/:id
 * @desc    Get user by ID
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/users/:id',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getUserById
);

/**
 * @route   PUT /api/admin/users/:id/toggle-status
 * @desc    Toggle user active/inactive status (block/unblock)
 * @access  Private (Admin with canManageUsers permission)
 */
router.put(
  '/users/:id/toggle-status',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.toggleUserStatus
);

/**
 * @route   DELETE /api/admin/users/:id
 * @desc    Delete user account permanently
 * @access  Private (Admin with canManageUsers permission)
 */
router.delete(
  '/users/:id',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.deleteUser
);

// ============ BUSINESS OWNER MANAGEMENT ============

/**
 * @route   GET /api/admin/business-owners
 * @desc    Get all business owners with search and pagination
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/business-owners',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getAllBusinessOwners
);

/**
 * @route   GET /api/admin/business-owners/:id
 * @desc    Get business owner details
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/business-owners/:id',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getBusinessOwnerDetails
);

/**
 * @route   GET /api/admin/business-owners/:id/employees
 * @desc    Get employees for a business owner
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/business-owners/:id/employees',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getBusinessOwnerEmployees
);

/**
 * @route   GET /api/admin/employees/:id
 * @desc    Get employee details
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/employees/:id',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getEmployeeDetails
);

/**
 * @route   PUT /api/admin/business-owners/:id/toggle-status
 * @desc    Block/Unblock business owner
 * @access  Private (Admin with canManageUsers permission)
 */
router.put(
  '/business-owners/:id/toggle-status',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.toggleBusinessOwnerStatus
);

/**
 * @route   DELETE /api/admin/business-owners/:id
 * @desc    Delete business owner account permanently
 * @access  Private (Admin with canManageUsers permission)
 */
router.delete(
  '/business-owners/:id',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.deleteBusinessOwner
);

/**
 * @route   GET /api/admin/reviews/businesses
 * @desc    Get business reviews for moderation
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/reviews/businesses',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getBusinessReviews
);

/**
 * @route   PATCH /api/admin/reviews/businesses/:sourceType/:id/hide
 * @desc    Hide business review
 * @access  Private (Admin with canManageUsers permission)
 */
router.patch(
  '/reviews/businesses/:sourceType/:id/hide',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.hideBusinessReview
);

/**
 * @route   PATCH /api/admin/reviews/businesses/:sourceType/:id/restore
 * @desc    Restore business review
 * @access  Private (Admin with canManageUsers permission)
 */
router.patch(
  '/reviews/businesses/:sourceType/:id/restore',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.restoreBusinessReview
);

/**
 * @route   GET /api/admin/discovery/businesses/ranking
 * @desc    Get business discovery ranking (pinned businesses in order)
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/discovery/businesses/ranking',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getBusinessDiscoveryRanking
);

/**
 * @route   PUT /api/admin/discovery/businesses/ranking
 * @desc    Bulk update business discovery ranking
 * @access  Private (Admin with canManageUsers permission)
 */
router.put(
  '/discovery/businesses/ranking',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.updateBusinessDiscoveryRanking
);

// ============ EVENT MANAGER MANAGEMENT ============

/**
 * @route   GET /api/admin/event-managers
 * @desc    Get all event managers with search and pagination
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/event-managers',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getAllEventManagers
);

/**
 * @route   GET /api/admin/event-managers/:id
 * @desc    Get event manager details
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/event-managers/:id',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getEventManagerDetails
);

/**
 * @route   GET /api/admin/event-managers/:id/events
 * @desc    Get events for a specific event manager
 * @access  Private (Admin with canManageUsers permission)
 */
router.get(
  '/event-managers/:id/events',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.getEventManagerEvents
);

/**
 * @route   PUT /api/admin/event-managers/:id/toggle-status
 * @desc    Block/Unblock event manager
 * @access  Private (Admin with canManageUsers permission)
 */
router.put(
  '/event-managers/:id/toggle-status',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.toggleEventManagerStatus
);

/**
 * @route   DELETE /api/admin/event-managers/:id
 * @desc    Delete event manager account permanently
 * @access  Private (Admin with canManageUsers permission)
 */
router.delete(
  '/event-managers/:id',
  verifyAdminToken,
  requirePermission('canManageUsers'),
  adminController.deleteEventManager
);

// ============ ADMIN MANAGEMENT (Super-Admin Only) ============

/**
 * @route   GET /api/admin/admins
 * @desc    Get all admins
 * @access  Private (Super-Admin only)
 */
router.get(
  '/admins',
  verifyAdminToken,
  requireSuperAdmin,
  adminController.getAllAdmins
);

/**
 * @route   POST /api/admin/admins
 * @desc    Create new admin
 * @access  Private (Super-Admin only)
 */
router.post(
  '/admins',
  verifyAdminToken,
  requireSuperAdmin,
  adminController.createAdmin
);

/**
 * @route   GET /api/admin/admins/:id
 * @desc    Get admin by ID
 * @access  Private (Super-Admin only)
 */
router.get(
  '/admins/:id',
  verifyAdminToken,
  requireSuperAdmin,
  adminController.getAdminById
);

/**
 * @route   PUT /api/admin/admins/:id
 * @desc    Update admin
 * @access  Private (Super-Admin only)
 */
router.put(
  '/admins/:id',
  verifyAdminToken,
  requireSuperAdmin,
  adminController.updateAdmin
);

/**
 * @route   PUT /api/admin/admins/:id/toggle-status
 * @desc    Toggle admin active/inactive status
 * @access  Private (Super-Admin only)
 */
router.put(
  '/admins/:id/toggle-status',
  verifyAdminToken,
  requireSuperAdmin,
  adminController.toggleAdminStatus
);

/**
 * @route   DELETE /api/admin/admins/:id
 * @desc    Delete admin
 * @access  Private (Super-Admin only)
 */
router.delete(
  '/admins/:id',
  verifyAdminToken,
  requireSuperAdmin,
  adminController.deleteAdmin
);

// ============ CATEGORY MANAGEMENT ============

/**
 * @route   POST /api/admin/categories/upload-icon
 * @desc    Upload category icon to Cloudinary
 * @access  Private (Admin with canManageSettings permission)
 */
router.post(
  '/categories/upload-icon',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  uploadCategoryIcon,
  handleUploadError,
  categoryController.uploadCategoryIcon
);

/**
 * @route   POST /api/admin/categories
 * @desc    Create new category (supports both JSON and form-data with icon upload)
 * @access  Private (Admin with canManageSettings permission)
 */
router.post(
  '/categories',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  uploadCategoryIcon,
  handleUploadError,
  categoryController.createCategory
);

/**
 * @route   GET /api/admin/categories
 * @desc    Get all categories (including inactive)
 * @access  Private (Admin)
 */
router.get(
  '/categories',
  verifyAdminToken,
  categoryController.getAllCategoriesAdmin
);

/**
 * @route   GET /api/admin/categories/:id
 * @desc    Get category by ID
 * @access  Private (Admin)
 */
router.get(
  '/categories/:id',
  verifyAdminToken,
  categoryController.getCategoryByIdAdmin
);

/**
 * @route   PUT /api/admin/categories/:id
 * @desc    Update category (supports both JSON and form-data with icon upload)
 * @access  Private (Admin with canManageSettings permission)
 */
router.put(
  '/categories/:id',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  uploadCategoryIcon,
  handleUploadError,
  categoryController.updateCategory
);

/**
 * @route   PUT /api/admin/categories/:id/toggle-status
 * @desc    Toggle category active/inactive status
 * @access  Private (Admin with canManageSettings permission)
 */
router.put(
  '/categories/:id/toggle-status',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  categoryController.toggleCategoryStatus
);

/**
 * @route   DELETE /api/admin/categories/:id
 * @desc    Delete category
 * @access  Private (Admin with canManageSettings permission)
 */
router.delete(
  '/categories/:id',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  categoryController.deleteCategory
);

// ============ SETTINGS MANAGEMENT ============

/**
 * @route   GET /api/admin/settings
 * @desc    Get all settings
 * @access  Private (Admin with canManageSettings permission)
 */
router.get(
  '/settings',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  adminController.getAllSettings
);

/**
 * @route   GET /api/admin/settings/:key
 * @desc    Get settings by key
 * @access  Private (Admin with canManageSettings permission)
 */
router.get(
  '/settings/:key',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  adminController.getSettingsByKey
);

/**
 * @route   PUT /api/admin/settings/:key
 * @desc    Create or update settings (Terms & Conditions, Privacy Policy, etc.)
 * @access  Private (Admin with canManageSettings permission)
 */
router.put(
  '/settings/:key',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  adminController.updateSettings
);

/**
 * @route   POST /api/admin/notifications/broadcast
 * @desc    Broadcast notification to platform users
 * @access  Private (Admin with canManageSettings permission)
 */
router.post(
  '/notifications/broadcast',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  adminController.broadcastNotification
);

// ============ FAQ MANAGEMENT ============

/**
 * @route   GET /api/admin/faqs
 * @desc    Get all FAQs
 * @access  Private (Admin with canManageSettings permission)
 */
router.get(
  '/faqs',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  faqController.getAllFaqs
);

/**
 * @route   POST /api/admin/faqs
 * @desc    Create FAQ
 * @access  Private (Admin with canManageSettings permission)
 */
router.post(
  '/faqs',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  faqController.createFaq
);

/**
 * @route   PUT /api/admin/faqs/:id
 * @desc    Update FAQ
 * @access  Private (Admin with canManageSettings permission)
 */
router.put(
  '/faqs/:id',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  faqController.updateFaq
);

/**
 * @route   DELETE /api/admin/faqs/:id
 * @desc    Delete FAQ
 * @access  Private (Admin with canManageSettings permission)
 */
router.delete(
  '/faqs/:id',
  verifyAdminToken,
  requirePermission('canManageSettings'),
  faqController.deleteFaq
);

module.exports = router;
