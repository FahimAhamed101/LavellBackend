const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employeeController');
const { uploadEmployeeServicePhoto, uploadEmployeeFiles, handleUploadError } = require('../middleware/upload');
const businessOwnerAuth = require('../middleware/businessOwnerAuth');

/**
 * @route   POST /api/business-owners/employees
 * @desc    Create employee with first service
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.post(
  '/',
  businessOwnerAuth,
  uploadEmployeeFiles,
  handleUploadError,
  employeeController.createEmployeeWithService
);

/**
 * @route   POST /api/business-owners/employees/basic
 * @desc    Create employee only (without service/appointment)
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.post(
  '/basic',
  businessOwnerAuth,
  uploadEmployeeFiles,
  handleUploadError,
  employeeController.createEmployeeOnly
);

/**
 * @route   GET /api/business-owners/employees
 * @desc    List all employees for business owner
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.get(
  '/',
  businessOwnerAuth,
  employeeController.listEmployees
);

/**
 * @route   GET /api/business-owners/employees/search
 * @desc    Search employees for business owner
 * @access  Private (Business Owner only)
 * @query   q, page, limit
 * @auth    Business Owner token required
 */
router.get(
  '/search',
  businessOwnerAuth,
  employeeController.searchEmployees
);

/**
 * @route   GET /api/business-owners/employees/:id/overview
 * @desc    Get employee overview, activities, and orders
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.get(
  '/:id/overview',
  businessOwnerAuth,
  employeeController.getEmployeeOverview
);

/**
 * @route   GET /api/business-owners/employees/:id
 * @desc    Get employee detail with all services
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.get(
  '/:id',
  businessOwnerAuth,
  employeeController.getEmployeeDetail
);

/**
 * @route   GET /api/business-owners/employees/:id/phone
 * @desc    Get employee phone number
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.get(
  '/:id/phone',
  businessOwnerAuth,
  employeeController.getEmployeePhoneNumber
);

/**
 * @route   PUT /api/business-owners/employees/:id
 * @desc    Update employee information
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.put(
  '/:id',
  businessOwnerAuth,
  uploadEmployeeFiles,
  handleUploadError,
  employeeController.updateEmployee
);

/**
 * @route   PATCH /api/business-owners/employees/:id/toggle-status
 * @desc    Block/unblock employee
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.patch(
  '/:id/toggle-status',
  businessOwnerAuth,
  employeeController.toggleEmployeeStatus
);

/**
 * @route   DELETE /api/business-owners/employees/:id
 * @desc    Delete employee (cascade soft delete services)
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.delete(
  '/:id',
  businessOwnerAuth,
  employeeController.deleteEmployee
);

/**
 * @route   POST /api/business-owners/employees/:employeeId/services
 * @desc    Add service to existing employee
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.post(
  '/:employeeId/services',
  businessOwnerAuth,
  uploadEmployeeServicePhoto,
  handleUploadError,
  employeeController.addService
);

/**
 * @route   GET /api/business-owners/employees/:employeeId/services
 * @desc    Get all services for an employee
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.get(
  '/:employeeId/services',
  businessOwnerAuth,
  employeeController.getEmployeeServices
);

/**
 * @route   PUT /api/business-owners/employees/:employeeId/services/:id
 * @desc    Update employee service
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.put(
  '/:employeeId/services/:id',
  businessOwnerAuth,
  uploadEmployeeServicePhoto,
  handleUploadError,
  employeeController.updateService
);

/**
 * @route   DELETE /api/business-owners/employees/:employeeId/services/:id
 * @desc    Delete employee service
 * @access  Private (Business Owner only)
 * @auth    Business Owner token required
 */
router.delete(
  '/:employeeId/services/:id',
  businessOwnerAuth,
  employeeController.deleteService
);

module.exports = router;
